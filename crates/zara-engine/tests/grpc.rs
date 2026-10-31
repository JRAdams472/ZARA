//! gRPC EngineControl tests (ADR-0004) — the headline Z4 acceptance:
//! a snapshot published over gRPC serves in eval WITHOUT a restart.
//! Spins a real tonic server + real generated client in-process against
//! the real data plane; the mutation side uses MIGRATE_DATABASE_URL
//! (zara_engine is SELECT-only). Skips when DSNs are unset.

mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tower::ServiceExt;
use zara_engine::api::{router, AppState};
use zara_engine::auth::JwtValidator;
use zara_engine::grpc::{pb, EngineControlService};
use zara_engine::snapshot::SnapshotStore;

use common::{mint, ACME, AUDIENCE, ISSUER, JWKS_JSON};

struct Rig {
    app: axum::Router,
    client: pb::engine_control_client::EngineControlClient<tonic::transport::Channel>,
    migrate: PgPool,
}

async fn rig() -> Option<Rig> {
    let (Ok(read_dsn), Ok(write_dsn)) = (
        std::env::var("ENGINE_DATABASE_URL"),
        std::env::var("MIGRATE_DATABASE_URL"),
    ) else {
        eprintln!("skip: ENGINE_/MIGRATE_DATABASE_URL unset");
        return None;
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&read_dsn)
        .await
        .unwrap();
    let migrate = PgPoolOptions::new()
        .max_connections(2)
        .connect(&write_dsn)
        .await
        .unwrap();
    let auth = Arc::new(
        JwtValidator::for_static(Some(ISSUER), &[AUDIENCE.to_string()], JWKS_JSON).unwrap(),
    );
    let store = Arc::new(SnapshotStore::default());
    let state = AppState {
        pool: pool.clone(),
        auth: auth.clone(),
        store: store.clone(),
    };

    let svc = EngineControlService::server(pool, store, auth);
    // Reserve an ephemeral port, release, and let tonic bind it — the
    // standard in-process test pattern (avoids a tokio-stream dep).
    let addr = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap()
        .local_addr()
        .unwrap();
    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(svc)
            .serve(addr)
            .await
            .unwrap();
    });
    // tonic channels connect lazily — wait for the listener so the first
    // RPC can't race a refused socket into Code::Unknown.
    for _ in 0..50 {
        if tokio::net::TcpStream::connect(addr).await.is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let client = pb::engine_control_client::EngineControlClient::connect(format!("http://{addr}"))
        .await
        .unwrap();
    Some(Rig {
        app: router(state),
        client,
        migrate,
    })
}

fn bearer(token: &str) -> tonic::metadata::MetadataValue<tonic::metadata::Ascii> {
    format!("Bearer {token}").parse().unwrap()
}

async fn eval_fees(app: &axum::Router, token: &str) -> usize {
    let body = json!({
        "tenantId": ACME,
        "scenario": {"loan": {"purpose": "rateTermRefi", "amount": 500000}, "borrower": {"vaEligible": true}}
    });
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/evaluate/dev")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 64 * 1024)
        .await
        .unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status, axum::http::StatusCode::OK, "eval failed: {v}");
    v["fees"].as_array().map(Vec::len).unwrap_or(0)
}

/// `it-grpc-fee` is a published row — the immutable trigger forbids DELETE,
/// so cleanup toggles it (allowed: `zara_migrate` owns the table). Runs
/// before AND after the test so a crashed run can't poison the next one.
async fn clean_test_artifact(migrate: &PgPool) {
    // The DELETE must see the row through RLS — set the tenant GUC in-tx.
    // (A bare query would hit ''-placeholder connections and error on
    // ''::uuid — a tx-local set_config leaves the session placeholder.)
    let mut tx = migrate.begin().await.unwrap();
    sqlx::query("SELECT set_config('zara.tenant_id', $1, true)")
        .bind(ACME)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "ALTER TABLE zara_dev.rule_artifacts DISABLE TRIGGER rule_artifacts_immutable_published",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("DELETE FROM zara_dev.rule_artifacts WHERE key = 'it-grpc-fee'")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "ALTER TABLE zara_dev.rule_artifacts ENABLE TRIGGER rule_artifacts_immutable_published",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn publish_hot_reloads_without_restart() {
    let Some(mut r) = rig().await else { return };
    clean_test_artifact(&r.migrate).await;
    let token = mint(ACME, &["dev", "qa", "uat", "prod"], 300, &[]);
    let baseline = eval_fees(&r.app, &token).await;
    assert!(baseline > 0, "seeded eval should charge fees");

    // Simulate a promotion landing: a verbatim published copy under a new
    // key (written as zara_migrate with the tenant GUC — RLS applies).
    let mut tx = r.migrate.begin().await.unwrap();
    sqlx::query("SELECT set_config('zara.tenant_id', $1, true)")
        .bind(ACME)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO zara_dev.rule_artifacts \
           (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at) \
         SELECT tenant_id, 'it-grpc-fee', kind, 'published', spec, jdm, sha256, 'grpc-test', now() \
           FROM zara_dev.rule_artifacts \
          WHERE key = 'origination' AND status = 'published' AND tenant_id = $1::uuid",
    )
    .bind(ACME)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let mut req = tonic::Request::new(pb::PublishSnapshotRequest {
        tenant_id: ACME.into(),
        env: "dev".into(),
        expected_sha256: String::new(),
    });
    req.metadata_mut().insert("authorization", bearer(&token));
    let res = r.client.publish_snapshot(req).await.unwrap().into_inner();
    assert!(res.artifact_count > 0);

    // Same running process: the new artifact serves immediately.
    assert_eq!(eval_fees(&r.app, &token).await, baseline + 1);
    clean_test_artifact(&r.migrate).await;
}

#[tokio::test]
async fn unauthenticated_and_wrong_scope_denied() {
    let Some(mut r) = rig().await else { return };
    // No token → UNAUTHENTICATED.
    let err = r
        .client
        .publish_snapshot(pb::PublishSnapshotRequest {
            tenant_id: ACME.into(),
            env: "dev".into(),
            expected_sha256: String::new(),
        })
        .await
        .unwrap_err();
    assert_eq!(err.code(), tonic::Code::Unauthenticated);
    // Wrong tenant claim → PERMISSION_DENIED.
    let foreign = mint("00000000-0000-4000-8000-0000000000ff", &["dev"], 300, &[]);
    let mut req = tonic::Request::new(pb::PublishSnapshotRequest {
        tenant_id: ACME.into(),
        env: "dev".into(),
        expected_sha256: String::new(),
    });
    req.metadata_mut().insert("authorization", bearer(&foreign));
    let err = r.client.publish_snapshot(req).await.unwrap_err();
    assert_eq!(err.code(), tonic::Code::PermissionDenied);
    // Env outside permitted_environments → PERMISSION_DENIED.
    let dev_only = mint(ACME, &["dev"], 300, &[]);
    let mut req = tonic::Request::new(pb::PublishSnapshotRequest {
        tenant_id: ACME.into(),
        env: "prod".into(),
        expected_sha256: String::new(),
    });
    req.metadata_mut()
        .insert("authorization", bearer(&dev_only));
    let err = r.client.publish_snapshot(req).await.unwrap_err();
    assert_eq!(err.code(), tonic::Code::PermissionDenied);
}
