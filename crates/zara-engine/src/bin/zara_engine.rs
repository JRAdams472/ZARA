//! `zara-engine` — the execution-plane HTTP service (Z2, MPE-142).
//!
//! Startup: config → pool → JWT validator (JWKS/discovery or dev-static) →
//! shared SnapshotStore + background fingerprint poller (ADR-0004 self-heal
//! until Z4's gRPC publish) → router behind per-IP edge limits.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use zara_engine::api::{router, AppState};
use zara_engine::auth::JwtValidator;
use zara_engine::config::Config;
use zara_engine::limits::{edge_limit, EdgeLimits};
use zara_engine::snapshot::SnapshotStore;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,zara_engine=info,tower_http=info".into()),
        )
        .init();

    let cfg = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&cfg.database_url)
        .await
        .context("connecting with ENGINE_DATABASE_URL")?;

    let validator = match &cfg.static_jwks {
        Some(jwks) => {
            JwtValidator::for_static(cfg.oidc_issuer.as_deref(), &cfg.oidc_audience, jwks)?
        }
        None => JwtValidator::connect(
            cfg.oidc_issuer
                .as_deref()
                .expect("config requires OIDC_ISSUER without static JWKS"),
            &cfg.oidc_audience,
            cfg.oidc_jwks_url.as_deref(),
        )
        .await
        .context("building JWT validator")?,
    };

    let state = AppState {
        pool: pool.clone(),
        auth: Arc::new(validator),
        store: Arc::new(SnapshotStore::default()),
    };

    // Self-heal: re-probe cached partitions on an interval so publishes
    // land without a push channel (ADR-0004; gRPC publish arrives at Z4).
    {
        let store = state.store.clone();
        let pool = pool.clone();
        let interval = Duration::from_millis(cfg.snapshot_poll_ms);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(interval);
            loop {
                tick.tick().await;
                if let Err(e) = store.refresh_all(&pool).await {
                    tracing::warn!(error = %e, "snapshot refresh pass failed");
                }
            }
        });
    }

    let app = match EdgeLimits::from_env() {
        Some(limits) => {
            router(state).layer(axum::middleware::from_fn_with_state(limits, edge_limit))
        }
        None => router(state),
    };

    // Dual-stack first ([::] accepts v4-mapped on Windows + Linux defaults)
    // so `localhost` works regardless of family; IPv4-only fallback for
    // stacks without v6.
    let listener = match tokio::net::TcpListener::bind(("::", cfg.port)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", cfg.port))
            .await
            .with_context(|| format!("binding :{}", cfg.port))?,
    };
    tracing::info!(addr = %listener.local_addr()?, "zara-engine listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
