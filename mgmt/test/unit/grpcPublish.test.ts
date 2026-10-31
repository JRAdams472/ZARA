//! EnginePublisher wire contract — a REAL @grpc/grpc-js server stands
//! in for the engine: proves the client speaks the proto contract,
//! attaches the service-JWT metadata, maps the response, and rejects
//! cleanly on an unreachable engine (the poller-fallback path).

import { describe, expect, it } from 'vitest';
import {
  Server,
  ServerCredentials,
  type sendUnaryData,
  type ServerUnaryCall,
  type ServiceDefinition,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { createEnginePublisher } from '../../src/grpc/publish.js';
import type { Config } from '../../src/config.js';

const PROTO = fileURLToPath(
  new URL('../../../proto/zara/engine/v1/engine.proto', import.meta.url),
);

const ACME = 'aa5ce000-0000-4000-8000-0000000000ac';

interface Captured {
  req: { tenant_id: string; env: string; expected_sha256: string };
  auth: string[];
}

async function stubServer(): Promise<{ addr: string; calls: Captured[]; close: () => void }> {
  const def = loadSync(PROTO, { keepCase: true, longs: String, defaults: true });
  const svc = def['zara.engine.v1.EngineControl'] as ServiceDefinition;
  const calls: Captured[] = [];
  const server = new Server();
  server.addService(svc, {
    publishSnapshot(
      call: ServerUnaryCall<Captured['req'], unknown>,
      cb: sendUnaryData<unknown>,
    ) {
      calls.push({
        req: call.request,
        auth: call.metadata.get('authorization').map(String),
      });
      cb(null, { fingerprint: '3:2026-01-01', artifact_count: 4 });
    },
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (e, p) => {
      if (e) reject(e);
      else resolve(p);
    });
  });
  return {
    addr: `127.0.0.1:${port}`,
    calls,
    close: () => {
      server.forceShutdown();
    },
  };
}

function cfg(addr: string): Config {
  return {
    port: 0,
    databaseUrl: '',
    oidcAudience: [],
    rateLimitPerMin: 1,
    rateLimitMutationsPerMin: 1,
    rateLimitDisable: true,
    rateLimitTrustXff: false,
    engineGrpc: { addr, token: 'svc-token-abc' },
  };
}

describe('createEnginePublisher', () => {
  it('undefined when ENGINE_GRPC_ADDR unconfigured', () => {
    const c = cfg('');
    delete c.engineGrpc;
    expect(createEnginePublisher(c)).toBeUndefined();
  });

  it('publish sends contract fields + Bearer metadata, maps response', async () => {
    const s = await stubServer();
    try {
      const pub = createEnginePublisher(cfg(s.addr));
      const res = await pub!.publish(ACME, 'qa', 'deadbeef'.repeat(8));
      expect(res).toEqual({ fingerprint: '3:2026-01-01', artifactCount: 4 });
      expect(s.calls).toHaveLength(1);
      expect(s.calls[0]!.req).toEqual({
        tenant_id: ACME,
        env: 'qa',
        expected_sha256: 'deadbeef'.repeat(8),
      });
      expect(s.calls[0]!.auth).toEqual(['Bearer svc-token-abc']);
    } finally {
      s.close();
    }
  });

  it('rejects on unreachable engine — never swallows into success', async () => {
    // Port 1 (tcpmux) refuses: grpc-js retries until the short deadline.
    const pub = createEnginePublisher(cfg('127.0.0.1:1'), { deadlineMs: 300 });
    await expect(pub!.publish(ACME, 'qa', 'x')).rejects.toThrow();
  });
});
