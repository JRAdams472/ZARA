//! HTTP surface (Z2 phase 2): `GET /healthz` + `POST /api/evaluate/{env}`.
//!
//! The `auth_gate` middleware authenticates (401 absent/invalid) and stashes
//! the `Principal` in extensions; the handler then enforces scope: `{env}`
//! must parse to a known environment and appear in the token's
//! `permitted_environments` (403), and the body's tenant must resolve to the
//! claim's `tenant_id` (403). PII is rejected before evaluation (400, field
//! path only). Snapshots resolve through the hot `SnapshotStore` — the only
//! DB touch on the happy path is the fingerprint probe.

use std::sync::Arc;

use axum::extract::{Path, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{header, HeaderValue};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{AuthError, JwtValidator, Principal};
use crate::error::AppError;
use crate::eval::{evaluate_fees, EvalReport};
use crate::loader::Env;
use crate::pii_guard;
use crate::snapshot::SnapshotStore;

/// Hard ceiling on request bodies — fee scenarios are small; anything
/// bigger is abuse, not input.
pub const BODY_LIMIT: usize = 256 * 1024;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub auth: Arc<JwtValidator>,
    pub store: Arc<SnapshotStore>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/api/evaluate/{env}",
            post(evaluate).route_layer(middleware::from_fn_with_state(state.clone(), auth_gate)),
        )
        .layer(middleware::from_fn(security_headers))
        .layer(axum::extract::DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

/// Authenticate the bearer token and stash the `Principal`. Unauthenticated
/// requests only log — writing audit rows for bad/absent tokens is an
/// unbounded growth DoS vector (engine emits no audit writes anyway).
async fn auth_gate(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".into()))?;
    let principal = state.auth.validate(token).await.map_err(|e| {
        let m = match &e {
            AuthError::Invalid(m) => m.as_str(),
            AuthError::UnknownKid => "unknown signing key",
        };
        tracing::warn!(error = %m, "unauthenticated request rejected");
        AppError::Unauthorized(m.to_string())
    })?;
    req.extensions_mut().insert(principal);
    Ok(next.run(req).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalRequest {
    /// Tenant the scenario belongs to — slug or UUID; must equal the
    /// token's `tenant_id` claim (else 403).
    pub tenant_id: String,
    /// The loan/scenario payload handed to pii_guard then the engine.
    pub scenario: Value,
}

async fn evaluate(
    State(state): State<AppState>,
    principal: axum::Extension<Principal>,
    Path(env): Path<String>,
    Json(body): Json<EvalRequest>,
) -> Result<Json<EvalReport>, AppError> {
    let env = Env::parse(&env).map_err(|e| AppError::BadRequest(e.to_string()))?;
    if !principal.permits_env(env_slug(env)) {
        return Err(AppError::Forbidden(
            "environment not permitted by token".into(),
        ));
    }
    let tenant = resolve_tenant(&state.pool, &body.tenant_id).await?;
    if tenant != principal.tenant_id {
        return Err(AppError::Forbidden("tenant mismatch".into()));
    }
    pii_guard::check_scenario(&body.scenario)?;

    let snapshot = state
        .store
        .snapshot_for(&state.pool, env, tenant)
        .await
        .map_err(AppError::from)?;
    Ok(Json(evaluate_fees(&snapshot, &body.scenario).await?))
}

/// Body tenant → registry UUID: UUIDs pass through; slugs resolve via
/// `zara_control.tenants` (engine role has SELECT; unknown → 400).
async fn resolve_tenant(pool: &PgPool, raw: &str) -> Result<Uuid, AppError> {
    if let Ok(id) = Uuid::parse_str(raw) {
        return Ok(id);
    }
    sqlx::query_scalar("SELECT id FROM zara_control.tenants WHERE slug = $1 AND status='active'")
        .bind(raw)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| AppError::BadRequest("unknown tenant".into()))
}

fn env_slug(env: Env) -> &'static str {
    match env {
        Env::Dev => "dev",
        Env::Qa => "qa",
        Env::Uat => "uat",
        Env::Prod => "prod",
    }
}

/// Baseline response hardening on every response, including gate rejections
/// and health checks. The API serves JSON only, so the CSP is a deny-all
/// document policy that also kills framing (`frame-ancestors` covers the
/// `X-Frame-Options` gaps in modern browsers).
async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"),
    );
    h.insert(
        header::HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"),
    );
    res
}

async fn healthz(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "status": "ok", "db": "up" })))
}
