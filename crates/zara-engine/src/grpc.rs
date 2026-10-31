//! gRPC EngineControl service (ADR-0004) — the management plane's push
//! channel for snapshot publication. `PublishSnapshot` re-resolves the
//! (env, tenant) partition through the SAME `snapshot_for` path the
//! self-heal poller uses: fingerprint probe → rebuild on change → swap.
//! Auth is the existing claim contract: Bearer JWT on `authorization`
//! metadata, verified by the shared `JwtValidator`; the token's
//! `tenant_id` must match the request and `env` must be in
//! `permitted_environments`.

use std::sync::Arc;

use sqlx::PgPool;
use tonic::{metadata::MetadataMap, Request, Response, Status};
use uuid::Uuid;

use crate::auth::{JwtValidator, Principal};
use crate::loader::Env;
use crate::snapshot::SnapshotStore;

// Committed generated stubs (see build.rs / proto/zara/engine/v1/engine.proto).
// The lint waiver covers tonic's generated `Status` signatures only.
#[allow(clippy::result_large_err)]
pub mod pb {
    include!("grpc/gen/zara.engine.v1.rs");
}

use pb::engine_control_server::{EngineControl, EngineControlServer};

pub struct EngineControlService {
    pool: PgPool,
    store: Arc<SnapshotStore>,
    auth: Arc<JwtValidator>,
}

impl EngineControlService {
    pub fn server(
        pool: PgPool,
        store: Arc<SnapshotStore>,
        auth: Arc<JwtValidator>,
    ) -> EngineControlServer<Self> {
        EngineControlServer::new(Self { pool, store, auth })
    }

    // Boxed Status keeps the Result small (clippy::result_large_err);
    // callers deref back into the trait's `Status` signature.
    async fn principal(&self, meta: &MetadataMap) -> Result<Principal, Box<Status>> {
        let token = meta
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| Box::new(Status::unauthenticated("missing bearer token")))?;
        self.auth
            .validate(token)
            .await
            .map_err(|_| Box::new(Status::unauthenticated("invalid token")))
    }

    fn authorize(p: &Principal, tenant: Uuid, env: &str) -> Result<Env, Box<Status>> {
        if p.tenant_id != tenant {
            return Err(Box::new(Status::permission_denied("tenant mismatch")));
        }
        if !p.permits_env(env) {
            return Err(Box::new(Status::permission_denied(
                "env outside permitted_environments",
            )));
        }
        Env::parse(env).map_err(|e| Box::new(Status::invalid_argument(e.to_string())))
    }
}

#[tonic::async_trait]
impl EngineControl for EngineControlService {
    async fn publish_snapshot(
        &self,
        req: Request<pb::PublishSnapshotRequest>,
    ) -> Result<Response<pb::PublishSnapshotResponse>, Status> {
        let p = self.principal(req.metadata()).await.map_err(|e| *e)?;
        let r = req.get_ref();
        let tenant = r
            .tenant_id
            .parse::<Uuid>()
            .map_err(|_| Status::invalid_argument("tenant_id must be a uuid"))?;
        let env = Self::authorize(&p, tenant, &r.env).map_err(|e| *e)?;
        // snapshot_for re-probes the fingerprint itself — the call is a
        // no-op when nothing changed, a cache swap when it did.
        let snap = self
            .store
            .snapshot_for(&self.pool, env, tenant)
            .await
            .map_err(|e| Status::internal(format!("snapshot load failed: {e}")))?;
        tracing::info!(
            env = %env.schema(), tenant = %tenant,
            artifacts = snap.fees.len(),
            "snapshot published via gRPC"
        );
        Ok(Response::new(pb::PublishSnapshotResponse {
            fingerprint: snap.fingerprint.clone(),
            artifact_count: snap.fees.len() as i32,
        }))
    }

    async fn snapshot_status(
        &self,
        req: Request<pb::SnapshotStatusRequest>,
    ) -> Result<Response<pb::SnapshotStatusResponse>, Status> {
        let p = self.principal(req.metadata()).await.map_err(|e| *e)?;
        let r = req.get_ref();
        let tenant = r
            .tenant_id
            .parse::<Uuid>()
            .map_err(|_| Status::invalid_argument("tenant_id must be a uuid"))?;
        let env = Self::authorize(&p, tenant, &r.env).map_err(|e| *e)?;
        let snap = self
            .store
            .snapshot_for(&self.pool, env, tenant)
            .await
            .map_err(|e| Status::internal(format!("snapshot load failed: {e}")))?;
        Ok(Response::new(pb::SnapshotStatusResponse {
            cached: true,
            fingerprint: snap.fingerprint.clone(),
            artifact_count: snap.fees.len() as i32,
        }))
    }
}
