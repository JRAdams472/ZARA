//! EngineControl gRPC client (ADR-0004) — the management plane's push
//! channel for snapshot publication. Called post-commit by the promote
//! route so the engine's hot cache converges without a restart. STRICTLY
//! best-effort: rejection/timeout means "the SNAPSHOT_POLL_MS self-heal
//! will converge", never a failed promotion.
//!
//! Auth: a service JWT (aud=zara-engine) on `authorization` metadata,
//! carrying tenant_id + permitted_environments — the engine re-checks
//! both against the request. Dev: minted via scripts/devtoken.mjs into a
//! mounted file. h2c in dev; TLS via ENGINE_GRPC_TLS(+_CA_FILE) in prod.

import {
  credentials,
  loadPackageDefinition,
  Metadata,
  type ChannelCredentials,
  type ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';

export interface PublishResult {
  fingerprint: string;
  artifactCount: number;
}

export interface EnginePublisher {
  publish(tenantId: string, env: string, sha256: string): Promise<PublishResult>;
}

/** Repo-root proto contract; ENGINE_GRPC_PROTO overrides (image layout). */
const DEFAULT_PROTO = fileURLToPath(
  new URL('../../../proto/zara/engine/v1/engine.proto', import.meta.url),
);

interface EngineControlClient {
  publishSnapshot(
    req: { tenant_id: string; env: string; expected_sha256: string },
    meta: Metadata,
    opts: { deadline: number },
    cb: (
      err: ServiceError | null,
      res: { fingerprint?: string; artifact_count?: number },
    ) => void,
  ): void;
  close(): void;
}

/**
 * Build the publisher from config, or `undefined` when ENGINE_GRPC_ADDR
 * is unset — routes then report `published:false` and the engine poller
 * remains the convergence path (ADR-0004 fallback, not a misconfig).
 */
export function createEnginePublisher(
  cfg: Config,
  opts: { deadlineMs?: number } = {},
): EnginePublisher | undefined {
  const g = cfg.engineGrpc;
  if (!g) return undefined;
  const deadlineMs = opts.deadlineMs ?? 5_000;
  const token =
    g.token ?? (g.tokenFile ? readFileSync(g.tokenFile, 'utf8').trim() : undefined);
  const proto = loadSync(g.protoPath ?? DEFAULT_PROTO, {
    keepCase: true,
    longs: String,
    defaults: true,
  });
  const pkg = loadPackageDefinition(proto) as unknown as {
    zara: {
      engine: {
        v1: {
          EngineControl: new (addr: string, creds: ChannelCredentials) => EngineControlClient;
        };
      };
    };
  };
  const chanCreds = g.tls
    ? credentials.createSsl(g.tlsCaFile ? readFileSync(g.tlsCaFile) : null)
    : credentials.createInsecure();
  const client = new pkg.zara.engine.v1.EngineControl(g.addr, chanCreds);
  return {
    publish(tenantId, env, sha256) {
      const meta = new Metadata();
      if (token) meta.add('authorization', `Bearer ${token}`);
      return new Promise<PublishResult>((resolve, reject) => {
        client.publishSnapshot(
          { tenant_id: tenantId, env, expected_sha256: sha256 },
          meta,
          { deadline: Date.now() + deadlineMs },
          (err, res) => {
            if (err) reject(err);
            else {
              resolve({
                fingerprint: res.fingerprint ?? '',
                artifactCount: res.artifact_count ?? 0,
              });
            }
          },
        );
      });
    },
  };
}
