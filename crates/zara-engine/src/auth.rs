//! JWT resource-server validation (MPEx validator port) + the Zara context
//! gate. `connect` fetches keys from an explicit JWKS URL or via OIDC
//! discovery; `for_test`/`for_static` take a static JWKS document. The
//! asymmetric algorithm allowlist is checked before any signature work so
//! `none`/symmetric-alg confusion attacks die at the header parse.
//!
//! The claim contract (ADR-0004/Z3): `tenant_id` (uuid) scopes every read;
//! `permitted_environments` (string array) gates the `{env}` path segment.
//! Both are enforced here — the DB is never consulted for authorization.

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use std::time::{Duration, Instant};

use anyhow::Context;
use jsonwebtoken::jwk::{AlgorithmParameters, JwkSet};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use uuid::Uuid;

/// Signature algorithms accepted from the issuer. Symmetric algs (HS*) and
/// `none` can never appear here.
const ALLOWED_ALGS: &[Algorithm] = &[Algorithm::RS256, Algorithm::ES256, Algorithm::EdDSA];

/// Minimum interval between JWKS refreshes triggered by an unknown `kid`
/// (issuer key rotation). Bounds refresh traffic on a kid-scan attempt.
const REFRESH_INTERVAL: Duration = Duration::from_secs(300);

#[derive(Debug)]
pub enum AuthError {
    /// Token failed validation — malformed, bad signature, expired,
    /// wrong iss/aud, missing claims, or disallowed alg.
    Invalid(String),
    /// Signing key not found even after a JWKS refresh.
    UnknownKid,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(m) => write!(f, "invalid token: {m}"),
            Self::UnknownKid => write!(f, "unknown signing key"),
        }
    }
}
impl std::error::Error for AuthError {}

/// Validated claims + the Zara authorization context. `iss`/`aud`/`exp`/
/// `nbf`/`sub` are enforced by the validator; `tenant_id` and
/// `permitted_environments` are required for a Principal to exist at all.
#[derive(Debug, Clone, Deserialize)]
pub struct TokenClaims {
    pub sub: String,
    pub tenant_id: Uuid,
    #[serde(default)]
    pub permitted_environments: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// The authenticated caller, stashed in request extensions by the gate.
#[derive(Debug, Clone)]
pub struct Principal {
    pub sub: String,
    pub tenant_id: Uuid,
    /// Normalized env slugs the token may evaluate against (dev|qa|uat|prod).
    pub permitted_envs: HashSet<String>,
}

impl Principal {
    pub fn permits_env(&self, env: &str) -> bool {
        self.permitted_envs.contains(env)
    }
}

struct KeyCache {
    by_kid: HashMap<String, DecodingKey>,
    refreshed_at: Instant,
}

pub struct JwtValidator {
    expected_iss: Option<String>,
    expected_aud: Vec<String>,
    client: reqwest::Client,
    /// Explicit JWKS endpoint; `None` on the static path (no refresh possible).
    jwks_url: Option<String>,
    keys: RwLock<KeyCache>,
}

impl JwtValidator {
    /// Build a validator from either an explicit JWKS URL or OIDC
    /// discovery on the issuer. Fetches the key set eagerly — callers
    /// handle retry (see `auth::init`).
    pub async fn connect(
        issuer: &str,
        audiences: &[String],
        jwks_url: Option<&str>,
    ) -> anyhow::Result<Self> {
        let client = reqwest::Client::new();
        let jwks_url = match jwks_url {
            Some(u) => u.to_string(),
            None => {
                let discovery_url = format!(
                    "{}/.well-known/openid-configuration",
                    issuer.trim_end_matches('/')
                );
                let discovery: serde_json::Value = client
                    .get(&discovery_url)
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?;
                discovery["jwks_uri"]
                    .as_str()
                    .context("discovery doc lacks jwks_uri")?
                    .to_string()
            }
        };
        let v = Self {
            expected_iss: Some(issuer.into()),
            expected_aud: audiences.to_vec(),
            client,
            jwks_url: Some(jwks_url),
            keys: RwLock::new(KeyCache {
                by_kid: HashMap::new(),
                refreshed_at: Instant::now()
                    .checked_sub(REFRESH_INTERVAL)
                    .unwrap_or_else(Instant::now),
            }),
        };
        v.refresh().await?;
        Ok(v)
    }

    /// Static-JWKS validator for dev/test: no network, no refresh. The
    /// issuer check still applies when `issuer` is set — static keys only
    /// bypass fetching, not validation.
    pub fn for_static(
        issuer: Option<&str>,
        audiences: &[String],
        jwks_json: &str,
    ) -> anyhow::Result<Self> {
        let jwks: JwkSet = serde_json::from_str(jwks_json)?;
        Ok(Self {
            expected_iss: issuer.map(str::to_string),
            expected_aud: audiences.to_vec(),
            client: reqwest::Client::new(),
            jwks_url: None,
            keys: RwLock::new(KeyCache {
                by_kid: decode_keys(&jwks),
                refreshed_at: Instant::now(),
            }),
        })
    }

    /// Validate a compact JWT: header alg allowlist → kid lookup (refresh
    /// once on miss) → signature + iss/aud/exp/nbf/sub checks → tenant/env
    /// claims required by the gate.
    pub async fn validate(&self, token: &str) -> Result<Principal, AuthError> {
        let header =
            decode_header(token).map_err(|e| AuthError::Invalid(format!("malformed: {e}")))?;
        if !ALLOWED_ALGS.contains(&header.alg) {
            return Err(AuthError::Invalid(format!(
                "alg {:?} not allowed",
                header.alg
            )));
        }
        let kid = header
            .kid
            .ok_or_else(|| AuthError::Invalid("missing kid".into()))?;

        let key = self.key_for(&kid).await.ok_or(AuthError::UnknownKid)?;

        let mut validation = Validation::new(header.alg);
        validation.leeway = 60;
        // Static-JWKS dev path without a configured issuer: the claim is
        // still required (below) but its value isn't pinned.
        if let Some(iss) = &self.expected_iss {
            validation.set_issuer(&[iss.as_str()]);
        }
        validation.set_audience(&self.expected_aud);
        validation.required_spec_claims = ["exp", "iss", "aud", "sub"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        validation.validate_nbf = true;

        let data = decode::<TokenClaims>(token, &key, &validation)
            .map_err(|e| AuthError::Invalid(e.to_string()))?;
        let claims = data.claims;
        if claims.permitted_environments.is_empty() {
            return Err(AuthError::Invalid(
                "token carries no permitted_environments".into(),
            ));
        }
        Ok(Principal {
            sub: claims.sub,
            tenant_id: claims.tenant_id,
            permitted_envs: claims
                .permitted_environments
                .into_iter()
                .map(|e| e.to_lowercase())
                .collect(),
        })
    }

    /// Kid lookup; on a cache miss, refreshes the JWKS once (bounded by
    /// REFRESH_INTERVAL) and retries — issuer key rotation.
    async fn key_for(&self, kid: &str) -> Option<DecodingKey> {
        if let Some(k) = self.keys.read().ok()?.by_kid.get(kid) {
            return Some(k.clone());
        }
        {
            let cache = self.keys.read().ok()?;
            if self.jwks_url.is_none() || cache.refreshed_at.elapsed() < REFRESH_INTERVAL {
                return None;
            }
        }
        if self.refresh().await.is_ok() {
            self.keys.read().ok()?.by_kid.get(kid).cloned()
        } else {
            None
        }
    }

    async fn refresh(&self) -> anyhow::Result<()> {
        let Some(url) = &self.jwks_url else {
            return Ok(());
        };
        let jwks: JwkSet = self
            .client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let mut cache = self
            .keys
            .write()
            .map_err(|_| anyhow::anyhow!("jwks cache poisoned"))?;
        cache.by_kid = decode_keys(&jwks);
        cache.refreshed_at = Instant::now();
        Ok(())
    }
}

fn decode_keys(jwks: &JwkSet) -> HashMap<String, DecodingKey> {
    jwks.keys
        .iter()
        .filter_map(|j| {
            let kid = j.common.key_id.clone()?;
            let key = match &j.algorithm {
                AlgorithmParameters::RSA(p) => DecodingKey::from_rsa_components(&p.n, &p.e).ok()?,
                AlgorithmParameters::EllipticCurve(p) => {
                    DecodingKey::from_ec_components(&p.x, &p.y).ok()?
                }
                AlgorithmParameters::OctetKeyPair(p) => {
                    DecodingKey::from_ed_components(&p.x).ok()?
                }
                _ => return None,
            };
            Some((kid, key))
        })
        .collect()
}
