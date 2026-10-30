//! Zara execution engine core (Z2, MPE-142).
//!
//! MPEx engine base adapted to Zara's data plane: published `rule_artifacts`
//! resolve into per-(env, tenant) snapshots held in a hot in-memory cache;
//! evaluation runs the fee model — `base_fee` graphs decide a fee is charged
//! and its base amount, `adjustment_set` graphs emit ordered ops applied on
//! top (docs/fee-model.md). The eval boundary rejects PII (ADR-0005) and the
//! eval path does no I/O — snapshots are pre-resolved and evaluation runs on
//! `!Send` worker threads (zen `Variable` is `Rc`-based).

pub mod api;
pub mod auth;
pub mod config;
pub mod error;
pub mod eval;
pub mod limits;
pub mod loader;
pub mod pii_guard;
pub mod snapshot;
