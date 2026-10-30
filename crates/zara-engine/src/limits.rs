//! Edge hardening (MPEx EdgeLimits port): per-IP token-bucket rate limit,
//! applied in `main` so test routers stay un-throttled. The engine surface
//! is eval-only — every route draws the single global bucket; a mutation
//! tier returns when routes that write exist.
//!
//! X-Forwarded-For is only honored when RATE_LIMIT_TRUST_XFF is set: without
//! a deployed proxy rewriting it, XFF is attacker-controlled and would let
//! anyone reset their own bucket. Peer IP comes from `ConnectInfo`.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::middleware::Next;
use axum::response::Response;
use governor::clock::Clock as _;
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};

use crate::error::AppError;

const DEFAULT_PER_MIN: u32 = 240;

/// Per-IP bucket for the request tier.
pub struct EdgeLimits {
    global: DefaultKeyedRateLimiter<IpAddr>,
    trust_xff: bool,
}

impl EdgeLimits {
    pub fn new(global_per_min: u32) -> Self {
        Self {
            global: RateLimiter::dashmap(Quota::per_minute(nz(global_per_min))),
            trust_xff: false,
        }
    }

    /// Trust X-Forwarded-For for the bucket key — only correct behind a proxy
    /// that overwrites the header.
    pub fn trust_xff(mut self, trust: bool) -> Self {
        self.trust_xff = trust;
        self
    }

    pub fn from_env() -> Option<Arc<Self>> {
        if std::env::var("RATE_LIMIT_DISABLE").is_ok() {
            tracing::warn!("RATE_LIMIT_DISABLE set — per-IP limits off");
            return None;
        }
        Some(Arc::new(
            Self::new(env_u32("RATE_LIMIT_PER_MIN", DEFAULT_PER_MIN))
                .trust_xff(std::env::var("RATE_LIMIT_TRUST_XFF").is_ok()),
        ))
    }
}

fn nz(v: u32) -> NonZeroU32 {
    NonZeroU32::new(v.max(1)).expect("clamped to >= 1")
}

fn env_u32(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn client_ip(req: &Request, trust_xff: bool) -> IpAddr {
    if trust_xff {
        if let Some(first) = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|s| s.trim().parse().ok())
        {
            return first;
        }
    }
    // No ConnectInfo (tests / direct oneshot) → a shared "unknown" bucket.
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

/// Per-IP rate-limit middleware over the global bucket.
pub async fn edge_limit(
    State(limits): State<Arc<EdgeLimits>>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let ip = client_ip(&req, limits.trust_xff);
    let now = governor::clock::DefaultClock::default().now();
    if let Err(until) = limits.global.check_key(&ip) {
        return Err(AppError::TooManyRequests {
            bucket: "request",
            retry_after: until.wait_time_from(now).as_secs().max(1),
        });
    }
    Ok(next.run(req).await)
}
