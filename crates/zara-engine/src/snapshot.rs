//! Hot in-memory snapshot cache (MPEx snapshot-store pattern).
//!
//! A `Snapshot` resolves one `(env, tenant)` partition to plain data:
//! compiled decision JDM in a zen `MemoryLoader` behind a `CachedLoader`,
//! plus the fee metadata the eval path needs (which artifacts are base fees,
//! which adjustment sets apply to them). Snapshots are cached behind a cheap
//! fingerprint probe (`count:max(updated_at)` of published rows) — a publish
//! bumps the fingerprint and naturally invalidates the cached snapshot.
//! Eval threads never touch the database.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;
use zen_engine::loader::{CachedLoader, DynamicLoader, MemoryLoader};
use zen_engine::model::DecisionContent;

use crate::loader::{self, Env};

/// `rule_artifacts.kind` — the two graph roles in the fee model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactKind {
    BaseFee,
    AdjustmentSet,
}

/// Artifact metadata needed by evaluation: which graph to run and, for
/// adjustment sets, which base-fee artifact they alter (`spec.appliesTo`).
#[derive(Debug, Clone)]
pub struct FeeMeta {
    pub key: String,
    pub kind: ArtifactKind,
    pub applies_to: Option<String>,
}

pub struct Snapshot {
    pub fingerprint: String,
    pub loader: Arc<CachedLoader>,
    pub fees: Vec<FeeMeta>,
}

#[derive(Default)]
pub struct SnapshotStore {
    cache: RwLock<HashMap<(Env, Uuid), Arc<Snapshot>>>,
}

impl SnapshotStore {
    /// Resolve (and cache) the snapshot for `(env, tenant)`. The fingerprint
    /// probe is the only query on the hit path — a cheap count+max.
    pub async fn snapshot_for(
        &self,
        pool: &PgPool,
        env: Env,
        tenant: Uuid,
    ) -> Result<Arc<Snapshot>> {
        let fp = loader::fingerprint(pool, env, tenant).await?;
        if let Some(hit) = self
            .cache
            .read()
            .ok()
            .and_then(|c| c.get(&(env, tenant)).cloned())
            .filter(|s| s.fingerprint == fp)
        {
            return Ok(hit);
        }
        let snapshot = self.build(pool, env, tenant, fp).await?;
        if let Ok(mut cache) = self.cache.write() {
            cache.insert((env, tenant), snapshot.clone());
        }
        Ok(snapshot)
    }

    /// Rebuild the snapshot: every published artifact's `jdm` enters the
    /// loader keyed by artifact `key`; fee metadata comes from `kind`/`spec`.
    async fn build(
        &self,
        pool: &PgPool,
        env: Env,
        tenant: Uuid,
        fingerprint: String,
    ) -> Result<Arc<Snapshot>> {
        let rows = loader::load_published(pool, env, tenant).await?;
        let mem = MemoryLoader::default();
        let mut fees = Vec::with_capacity(rows.len());
        for row in &rows {
            // Isolate malformed artifacts: keep the FeeMeta (eval records a
            // line-level error for the key) but never let one bad row kill
            // the whole partition's snapshot — same containment rule as
            // eval's per-line errors.
            match serde_json::from_value::<DecisionContent>(row.jdm.clone()) {
                Ok(content) => mem.add(row.key.clone(), content),
                Err(e) => {
                    tracing::warn!(artifact = %row.key, error = %e, "skipping invalid published JDM")
                }
            }
            fees.push(FeeMeta {
                key: row.key.clone(),
                kind: match row.kind.as_str() {
                    "base_fee" => ArtifactKind::BaseFee,
                    _ => ArtifactKind::AdjustmentSet,
                },
                applies_to: row
                    .spec
                    .get("appliesTo")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            });
        }
        Ok(Arc::new(Snapshot {
            fingerprint,
            loader: Arc::new(CachedLoader::from(Arc::new(mem) as DynamicLoader)),
            fees,
        }))
    }

    /// Drop a partition's cached snapshot (tests / future gRPC invalidation).
    pub fn invalidate(&self, env: Env, tenant: Uuid) {
        if let Ok(mut cache) = self.cache.write() {
            cache.remove(&(env, tenant));
        }
    }

    /// Re-probe all cached partitions — the self-heal refresh the background
    /// poller calls on an interval (ADR-0004 pending Z4's gRPC publish).
    pub async fn refresh_all(&self, pool: &PgPool) -> Result<()> {
        let keys: Vec<(Env, Uuid)> = self
            .cache
            .read()
            .map(|c| c.keys().copied().collect())
            .unwrap_or_default();
        for (env, tenant) in keys {
            // snapshot_for re-checks the fingerprint — no-op on a hit.
            self.snapshot_for(pool, env, tenant).await?;
        }
        Ok(())
    }
}
