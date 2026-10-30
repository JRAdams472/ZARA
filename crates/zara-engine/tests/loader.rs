//! Loader path against a live data plane — runs in the CI `db` job where
//! migrations + seeds are applied. Skips quietly when ENGINE_DATABASE_URL
//! is unset so `cargo test` stays hermetic for contributors.

use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;
use zara_engine::eval::evaluate_fees;
use zara_engine::loader::Env;
use zara_engine::snapshot::SnapshotStore;

#[tokio::test(flavor = "multi_thread")]
async fn loads_and_evaluates_seeded_acme() {
    let Ok(dsn) = std::env::var("ENGINE_DATABASE_URL") else {
        eprintln!("skip: ENGINE_DATABASE_URL unset");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&dsn)
        .await
        .expect("connect");

    let (tenant,): (Uuid,) =
        sqlx::query_as("SELECT id FROM zara_control.tenants WHERE slug='acme-mortgage'")
            .fetch_one(&pool)
            .await
            .expect("seeded tenant");

    let store = SnapshotStore::default();
    let snap = store
        .snapshot_for(&pool, Env::Dev, tenant)
        .await
        .expect("snapshot");

    // Published artifacts only — drafts must not leak into the snapshot.
    assert_eq!(snap.fees.len(), 2);

    let scenario = json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
                          "borrower": {"vaEligible": true}});
    let report = evaluate_fees(&snap, &scenario).await.expect("eval");
    assert_eq!(report.fees[0].fee_code, "origination");
    assert_eq!(report.total, 400.0);

    // Wrong tenant GUC → zero artifacts (RLS still binds the engine role).
    let other: (Uuid,) =
        sqlx::query_as("SELECT id FROM zara_control.tenants WHERE slug='northstar-lending'")
            .fetch_one(&pool)
            .await
            .expect("second tenant");
    let snap_b = store
        .snapshot_for(&pool, Env::Dev, other.0)
        .await
        .expect("northstar snapshot");
    assert_eq!(snap_b.fees.len(), 2); // its own matrix, not acme's
    let report_b = evaluate_fees(&snap_b, &scenario).await.expect("eval b");
    // northstar base is 1200, its discount keys on firstResponder — a
    // veteran-shaped scenario still gets 1200 back (its own rules).
    assert_eq!(report_b.total, 1200.0);
}
