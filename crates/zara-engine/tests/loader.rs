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

    // Published artifacts only — a second 'origination' row would mean
    // the draft leaked. (Tolerant to other tenants' test residue — the
    // shared dev DB accumulates published rows the immutable trigger
    // makes permanent; CI's fresh Postgres always has exactly 2.)
    assert_eq!(
        snap.fees.iter().filter(|f| f.key == "origination").count(),
        1
    );
    assert_eq!(
        snap.fees
            .iter()
            .filter(|f| f.key == "origination-adj")
            .count(),
        1
    );

    let scenario = json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
                          "borrower": {"vaEligible": true}});
    let report = evaluate_fees(&snap, &scenario).await.expect("eval");
    let origination = report
        .fees
        .iter()
        .find(|l| l.artifact == "origination")
        .expect("seeded fee line");
    assert_eq!(origination.fee_code, "origination");
    assert_eq!(origination.total, 400.0);

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
    // Its own matrix, not acme's — RLS still binds the engine role.
    assert_eq!(
        snap_b
            .fees
            .iter()
            .filter(|f| f.key == "origination")
            .count(),
        1
    );
    let report_b = evaluate_fees(&snap_b, &scenario).await.expect("eval b");
    // northstar base is 1200, its discount keys on firstResponder — a
    // veteran-shaped scenario still gets 1200 back (its own rules).
    let line_b = report_b
        .fees
        .iter()
        .find(|l| l.artifact == "origination")
        .expect("northstar fee line");
    assert_eq!(line_b.total, 1200.0);
}
