//! `zara-bench` — latency harness for the eval hot path (MPE-142).
//!
//! Loads the published snapshot for one (env, tenant) partition exactly
//! like the service does, then evaluates a scenario N times on the real
//! `!Send` worker path and reports p50/p95/p99/max. The ticket budget is
//! 15 ms at p95 — the run fails (exit 1) if p95 exceeds `--budget-ms`.
//!
//!   zara-bench --env dev --tenant acme-mortgage --iterations 200

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;
use zara_engine::{eval::evaluate_fees, loader::Env, snapshot::SnapshotStore};

#[derive(Parser)]
#[command(version, about = "Zara eval latency benchmark")]
struct Args {
    /// DSN for the SELECT-only zara_engine role.
    #[arg(long, env = "ENGINE_DATABASE_URL")]
    dsn: String,

    /// Environment to evaluate against.
    #[arg(long, default_value = "dev")]
    env: String,

    /// Tenant slug or UUID.
    #[arg(long, default_value = "acme-mortgage")]
    tenant: String,

    /// Scenario: 'refi-veteran' | 'refi' | 'purchase' | path to a JSON file.
    #[arg(long, default_value = "refi-veteran")]
    scenario: String,

    /// Measured iterations (after a warmup pass).
    #[arg(long, default_value_t = 200)]
    iterations: u32,

    /// p95 budget in milliseconds — exit 1 when exceeded.
    #[arg(long, default_value_t = 15.0)]
    budget_ms: f64,
}

fn builtin(name: &str) -> Option<Value> {
    match name {
        // acme demo: charged 900, veteran −500 → 400 (amount under the
        // high-balance threshold so only the discount applies).
        "refi-veteran" => Some(json!({
            "loan": {"purpose": "rateTermRefi", "amount": 500000},
            "borrower": {"vaEligible": true}
        })),
        "refi" => Some(json!({
            "loan": {"purpose": "rateTermRefi", "amount": 500000},
            "borrower": {}
        })),
        "purchase" => Some(json!({
            "loan": {"purpose": "purchase", "amount": 500000},
            "borrower": {}
        })),
        _ => None,
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let env = Env::parse(&args.env)?;
    let scenario = match builtin(&args.scenario) {
        Some(v) => v,
        None => {
            let text = std::fs::read_to_string(PathBuf::from(&args.scenario))
                .with_context(|| format!("reading scenario {}", args.scenario))?;
            serde_json::from_str(&text).context("parsing scenario JSON")?
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&args.dsn)
        .await
        .context("connecting with engine DSN")?;

    let tenant = match Uuid::parse_str(&args.tenant) {
        Ok(id) => id,
        Err(_) => {
            let (id,): (Uuid,) =
                sqlx::query_as("SELECT id FROM zara_control.tenants WHERE slug=$1")
                    .bind(&args.tenant)
                    .fetch_one(&pool)
                    .await
                    .with_context(|| format!("resolving tenant {:?}", args.tenant))?;
            id
        }
    };

    let store = SnapshotStore::default();
    let snapshot = store.snapshot_for(&pool, env, tenant).await?;
    eprintln!(
        "snapshot: {}/{} fingerprint={} artifacts={}",
        env.schema(),
        tenant,
        snapshot.fingerprint,
        snapshot.fees.len()
    );

    // Warmup: loader compile + first-touch costs excluded from the budget.
    for _ in 0..10 {
        evaluate_fees(&snapshot, &scenario).await?;
    }

    let mut times = Vec::with_capacity(args.iterations as usize);
    for _ in 0..args.iterations {
        let t = std::time::Instant::now();
        let report = evaluate_fees(&snapshot, &scenario).await?;
        times.push(t.elapsed().as_secs_f64() * 1000.0);
        let _ = report;
    }
    times.sort_by(|a, b| a.total_cmp(b));

    let pct = |p: f64| -> f64 {
        let i = ((times.len() as f64 - 1.0) * p / 100.0).round() as usize;
        times[i.min(times.len() - 1)]
    };
    let (p50, p95, p99) = (pct(50.0), pct(95.0), pct(99.0));
    let max = times.last().copied().unwrap_or_default();
    let pass = p95 <= args.budget_ms;
    eprintln!("iterations: {}", times.len());
    println!(
        "p50={p50:.2}ms p95={p95:.2}ms p99={p99:.2}ms max={max:.2}ms budget={:.0}ms {}",
        args.budget_ms,
        if pass { "PASS" } else { "FAIL" }
    );
    if !pass {
        anyhow::bail!("p95 {p95:.2}ms exceeds {}ms budget", args.budget_ms);
    }
    Ok(())
}
