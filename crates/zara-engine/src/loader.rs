//! Snapshot loading from the data plane (ADR-0002).
//!
//! The engine reads through a dedicated SELECT-only `zara_engine` role that
//! spans the env schemas — but FORCE ROW LEVEL SECURITY still applies, so
//! every read runs inside a transaction with
//! `set_config('zara.tenant_id', …, true)` stamped first. No bypass, no
//! exception: the loader iterates the tenant registry and reads each
//! tenant's rows under that tenant's own GUC, exactly like a service
//! connection would. Loading happens off the eval path; eval threads never
//! touch the pool.

use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// The four promotion environments (ADR-0002). Schema names are
/// interpolated into SQL, so they come from this allowlist — never input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Env {
    Dev,
    Qa,
    Uat,
    Prod,
}

impl Env {
    pub fn schema(self) -> &'static str {
        match self {
            Self::Dev => "zara_dev",
            Self::Qa => "zara_qa",
            Self::Uat => "zara_uat",
            Self::Prod => "zara_prod",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "dev" => Ok(Self::Dev),
            "qa" => Ok(Self::Qa),
            "uat" => Ok(Self::Uat),
            "prod" => Ok(Self::Prod),
            other => anyhow::bail!("unknown env {other:?} — expected dev|qa|uat|prod"),
        }
    }
}

/// A published artifact row as loaded into a snapshot.
#[derive(Debug)]
pub struct ArtifactRow {
    pub key: String,
    pub kind: String,
    pub spec: Value,
    pub jdm: Value,
}

/// Active tenants from the control registry — `(id, slug)`.
pub async fn list_tenants(pool: &PgPool) -> Result<Vec<(Uuid, String)>> {
    sqlx::query_as("SELECT id, slug FROM zara_control.tenants WHERE status='active' ORDER BY slug")
        .fetch_all(pool)
        .await
        .context("listing tenants")
}

/// Cheap change probe for (env, tenant): `count:max(updated_at)` across
/// published artifacts. Any insert/publish bumps it.
pub async fn fingerprint(pool: &PgPool, env: Env, tenant: Uuid) -> Result<String> {
    let mut tx = pool.begin().await?;
    set_tenant(&mut tx, tenant).await?;
    let (n, maxu): (i64, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        format!(
            "SELECT count(*), max(updated_at) FROM {}.rule_artifacts WHERE status='published'",
            env.schema()
        )
        .as_str(),
    )
    .fetch_one(&mut *tx)
    .await
    .with_context(|| format!("fingerprinting {}/{}", env.schema(), tenant))?;
    tx.commit().await?;
    Ok(format!("{n}:{maxu:?}"))
}

/// All published artifacts for (env, tenant), deterministic order.
pub async fn load_published(pool: &PgPool, env: Env, tenant: Uuid) -> Result<Vec<ArtifactRow>> {
    let mut tx = pool.begin().await?;
    set_tenant(&mut tx, tenant).await?;
    let rows: Vec<(String, String, Value, Value)> = sqlx::query_as(
        format!(
            "SELECT key, kind, spec, jdm FROM {}.rule_artifacts \
             WHERE status='published' AND tenant_id=$1 ORDER BY key",
            env.schema()
        )
        .as_str(),
    )
    .bind(tenant)
    .fetch_all(&mut *tx)
    .await
    .with_context(|| format!("loading published artifacts {}/{}", env.schema(), tenant))?;
    tx.commit().await?;
    Ok(rows
        .into_iter()
        .map(|(key, kind, spec, jdm)| ArtifactRow {
            key,
            kind,
            spec,
            jdm,
        })
        .collect())
}

/// Stamp the tenant GUC for the current transaction (`is_local = true`).
/// The RLS policy compares `tenant_id` to `current_setting('zara.tenant_id')`
/// — unset means zero rows, wrong means a WITH CHECK violation on write.
async fn set_tenant(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, tenant: Uuid) -> Result<()> {
    sqlx::query("SELECT set_config('zara.tenant_id', $1, true)")
        .bind(tenant.to_string())
        .execute(&mut **tx)
        .await
        .context("stamping zara.tenant_id")?;
    Ok(())
}
