//! Engine error type + HTTP mapping. Denial classes map to distinct status
//! codes so a rejection can never degrade to a generic 500 (ADR-0005).
//! PII-guard rejections arrive as `BadRequest` carrying the field path only —
//! the guard constructs the message, this layer never adds detail.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
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

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::TooManyRequests {
            bucket,
            retry_after,
        } = &self
        {
            let mut res = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "error": format!("rate limited ({bucket} bucket)"),
                    "retryAfter": retry_after,
                })),
            )
                .into_response();
            res.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from(*retry_after),
            );
            return res;
        }
        let (status, message) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m.clone()),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            AppError::Internal(m) => {
                tracing::error!(error = %m, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
            }
            AppError::TooManyRequests { .. } => unreachable!(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}
