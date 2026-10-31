//! Service configuration from env — every knob documented in .env.example.
//! Fail-closed: missing required values abort startup; no defaults that
//! would silently weaken auth or limits.

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    /// DSN for the SELECT-only `zara_engine` role (snapshot loading).
    pub database_url: String,
    /// Expected token issuer — required unless ZARA_JWKS_JSON/FILE is set.
    pub oidc_issuer: Option<String>,
    /// Accepted `aud` values (comma-separated in env).
    pub oidc_audience: Vec<String>,
    /// Explicit JWKS URL; when unset the validator uses OIDC discovery on
    /// the issuer. Ignored when a static JWKS is configured.
    pub oidc_jwks_url: Option<String>,
    /// Dev/test escape: a static JWKS document (inline JSON or a file path).
    /// Never set in production — the validator can't refresh keys and the
    /// issuer check still applies, but a static set means whoever generated
    /// the matching key mints valid tokens. zara_devtoken writes these.
    pub static_jwks: Option<String>,
    /// Background fingerprint re-probe interval (ADR-0004 self-heal until
    /// Z4's gRPC publish lands).
    pub snapshot_poll_ms: u64,
    /// gRPC EngineControl listener port (ADR-0004). JWT-verified service
    /// calls; the HTTP eval surface is unchanged by this channel.
    pub grpc_port: u16,
    /// PEM cert/key for gRPC TLS 1.3. Both unset → h2c (dev carve-out,
    /// same shape as OpenBao tls_disable — auth still verified).
    pub grpc_tls_cert: Option<String>,
    pub grpc_tls_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let static_jwks = match (
            std::env::var("ZARA_JWKS_JSON"),
            std::env::var("ZARA_JWKS_FILE"),
        ) {
            (Ok(j), _) => Some(j),
            (Err(_), Ok(path)) => Some(
                std::fs::read_to_string(&path)
                    .with_context(|| format!("reading ZARA_JWKS_FILE {path}"))?,
            ),
            (Err(_), Err(_)) => None,
        };
        let oidc_issuer = std::env::var("OIDC_ISSUER").ok();
        if static_jwks.is_none() && oidc_issuer.is_none() {
            anyhow::bail!(
                "auth not configured: set OIDC_ISSUER (prod) or \
                 ZARA_JWKS_JSON/ZARA_JWKS_FILE (dev/test only)"
            );
        }
        let oidc_audience: Vec<String> = std::env::var("OIDC_AUDIENCE")
            .unwrap_or_else(|_| "zara-engine".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if static_jwks.is_some() {
            tracing::warn!(
                "static JWKS configured (ZARA_JWKS_JSON/ZARA_JWKS_FILE) — dev/test only, never prod"
            );
        }
        Ok(Self {
            port: env_parse("PORT", 8400)?,
            database_url: std::env::var("ENGINE_DATABASE_URL")
                .context("ENGINE_DATABASE_URL is required")?,
            oidc_issuer,
            oidc_audience,
            oidc_jwks_url: std::env::var("OIDC_JWKS_URL").ok(),
            static_jwks,
            snapshot_poll_ms: env_parse("SNAPSHOT_POLL_MS", 30_000)?,
            grpc_port: env_parse("GRPC_PORT", 9443)?,
            grpc_tls_cert: std::env::var("GRPC_TLS_CERT").ok(),
            grpc_tls_key: std::env::var("GRPC_TLS_KEY").ok(),
        })
    }
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> Result<T>
where
    T::Err: std::fmt::Display,
{
    match std::env::var(name) {
        Ok(v) => v
            .parse()
            .map_err(|e: T::Err| anyhow::anyhow!("{name}: {e}")),
        Err(_) => Ok(default),
    }
}
