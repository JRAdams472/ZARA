//! Service-path integration tests — minted JWTs + static test JWKS + a
//! real data plane. Runs in the CI `engine` job where migrations + seeds
//! are applied; skips quietly when ENGINE_DATABASE_URL is unset so
//! `cargo test` stays hermetic for contributors.
//!
//! Asserts the gate's status contract (401 absent/invalid/wrong-alg,
//! 403 env∉claims + body-tenant≠claim), the PII guard (400, field path
//! only — the submitted value must not appear in the response), and the
//! happy path against the seeded acme matrix (veteran refi → $400).

mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use zara_engine::api::{router, AppState};
use zara_engine::auth::JwtValidator;
use zara_engine::snapshot::SnapshotStore;

use common::{mint, mint_hs256, ACME, AUDIENCE, ISSUER, JWKS_JSON, NORTHSTAR};

async fn app() -> Option<axum::Router> {
    let Ok(dsn) = std::env::var("ENGINE_DATABASE_URL") else {
        eprintln!("skip: ENGINE_DATABASE_URL unset");
        return None;
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&dsn)
        .await
        .expect("connect");
    let auth = JwtValidator::for_static(Some(ISSUER), &[AUDIENCE.to_string()], JWKS_JSON)
        .expect("static validator");
    Some(router(AppState {
        pool,
        auth: Arc::new(auth),
        store: Arc::new(SnapshotStore::default()),
    }))
}

fn post(env: &str, token: Option<&str>, body: &Value) -> Request<Body> {
    let mut b = Request::builder()
        .method("POST")
        .uri(format!("/api/evaluate/{env}"))
        .header("content-type", "application/json");
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
    }
    b.body(Body::from(body.to_string())).unwrap()
}

async fn status(app: &axum::Router, req: Request<Body>) -> (StatusCode, Value) {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 64 * 1024)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({"raw": String::from_utf8_lossy(&bytes)}));
    (status, body)
}

fn scenario() -> Value {
    json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
           "borrower": {"vaEligible": true}})
}

fn eval_body(tenant: &str) -> Value {
    json!({"tenantId": tenant, "scenario": scenario()})
}

#[tokio::test(flavor = "multi_thread")]
async fn healthz_is_unauthenticated() {
    let Some(app) = app().await else { return };
    let req = Request::builder()
        .uri("/healthz")
        .body(Body::empty())
        .unwrap();
    let (status, body) = status(&app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_token_is_401() {
    let Some(app) = app().await else { return };
    let (status, _) = status(&app, post("dev", None, &eval_body(ACME))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn symmetric_alg_is_401() {
    let Some(app) = app().await else { return };
    let t = mint_hs256();
    let (status, _) = status(&app, post("dev", Some(&t), &eval_body(ACME))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn expired_token_is_401() {
    let Some(app) = app().await else { return };
    let t = mint(ACME, &["dev"], -3600, &[]);
    let (status, _) = status(&app, post("dev", Some(&t), &eval_body(ACME))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test(flavor = "multi_thread")]
async fn env_not_in_claims_is_403() {
    let Some(app) = app().await else { return };
    // Token permits dev only; qa must reject.
    let t = mint(ACME, &["dev"], 3600, &[]);
    let (status, _) = status(&app, post("qa", Some(&t), &eval_body(ACME))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test(flavor = "multi_thread")]
async fn foreign_tenant_is_403() {
    let Some(app) = app().await else { return };
    // Claim scoped to acme; body asks for northstar's matrix.
    let t = mint(ACME, &["dev"], 3600, &[]);
    let (status, _) = status(&app, post("dev", Some(&t), &eval_body(NORTHSTAR))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_env_is_400() {
    let Some(app) = app().await else { return };
    let t = mint(ACME, &["dev"], 3600, &[]);
    let (status, _) = status(&app, post("staging", Some(&t), &eval_body(ACME))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread")]
async fn pii_is_400_path_only() {
    let Some(app) = app().await else { return };
    let t = mint(ACME, &["dev"], 3600, &[]);
    let body = json!({
        "tenantId": ACME,
        "scenario": {
            "loan": {"purpose": "rateTermRefi", "amount": 500000},
            "borrower": {"ssn": "123-45-6789"}
        }
    });
    let (status, res) = status(&app, post("dev", Some(&t), &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let text = res.to_string();
    assert!(text.contains("borrower.ssn"), "expected field path: {text}");
    assert!(!text.contains("123-45-6789"), "response leaked the value");
}

#[tokio::test(flavor = "multi_thread")]
async fn happy_path_evaluates_seeded_matrix() {
    let Some(app) = app().await else { return };
    let t = mint(ACME, &["dev"], 3600, &[]);
    // Slug path also exercises resolve_tenant's registry lookup.
    let (status, res) = status(&app, post("dev", Some(&t), &eval_body("acme-mortgage"))).await;
    assert_eq!(status, StatusCode::OK, "body: {res}");
    assert_eq!(res["total"], 400.0);
    assert_eq!(res["fees"][0]["feeCode"], "origination");
    assert!(res["fingerprint"].as_str().unwrap().contains(':'));
}

#[tokio::test(flavor = "multi_thread")]
async fn eval_is_deterministic() {
    let Some(app) = app().await else { return };
    let t = mint(ACME, &["dev"], 3600, &[]);
    let (_, a) = status(&app, post("dev", Some(&t), &eval_body(ACME))).await;
    let (_, b) = status(&app, post("dev", Some(&t), &eval_body(ACME))).await;
    assert_eq!(a["fees"], b["fees"]);
    assert_eq!(a["fingerprint"], b["fingerprint"]);
}
