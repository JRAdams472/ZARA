//! Engine error type. HTTP mapping (`IntoResponse` + status codes) lands
//! with the axum surface in phase 2; the core already distinguishes the
//! classes so denial paths can never degrade to a generic 500.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    /// Malformed request — includes PII-guard rejections (path only).
    #[error("{0}")]
    BadRequest(String),
    /// Missing or invalid JWT.
    #[error("{0}")]
    Unauthorized(String),
    /// Authenticated but out of scope — foreign tenant or environment.
    #[error("{0}")]
    Forbidden(String),
    /// Per-IP rate limit tripped.
    #[error("rate limit ({bucket}) — retry in {retry_after}s")]
    TooManyRequests {
        bucket: &'static str,
        retry_after: u64,
    },
    /// Everything else — logged in detail, surfaced generically.
    #[error("{0}")]
    Internal(String),
}
