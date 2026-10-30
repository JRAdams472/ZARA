//! The deny-first context gate. `preHandler` on every /api route:
//! authenticate (401) → stash Principal → per-route role requirement
//! (403). `auth.denied` audit rows only for authenticated-but-insufficient
//! callers — bad/absent tokens only log (unbounded-write DoS vector).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type postgres from 'postgres';
import type { JwtValidator } from '../auth/jwks.js';
import { AuthError, principalFromClaims, type Principal } from '../auth/principal.js';
import { accessIn, parseEnv, type Role } from '../auth/roles.js';
import { record, AUDIT_ACTIONS } from '../db/audit.js';
import { withTenantTx } from '../db/pool.js';
import { forbidden, unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
  interface FastifyContextConfig {
    requiredRole?: Role;
  }
}

export interface AuthDeps {
  sql: postgres.Sql;
  validator: JwtValidator;
}

export function registerAuthGate(app: FastifyInstance, deps: AuthDeps): void {
  app.decorateRequest('principal');
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw unauthorized('missing bearer token');
    let principal: Principal;
    try {
      const { payload } = await deps.validator.verify(token);
      principal = await principalFromClaims(deps.sql, payload);
    } catch (e) {
      const m = e instanceof AuthError || e instanceof Error ? e.message : 'invalid token';
      req.log.warn({ err: m }, 'unauthenticated request rejected');
      throw unauthorized(m);
    }
    req.principal = principal;

    // Env-scoped routes: /api/envs/{env}/… — claims ∩ role scope.
    const envMatch = /^\/api\/envs\/([^/]+)/.exec(req.url);
    if (envMatch) {
      const env = parseEnv(envMatch[1] ?? '');
      if (!env) return; // unknown env → route 404s anyway
      if (!principal.permittedEnvs.includes(env)) {
        await denyFor(app, deps.sql, principal, req, `env ${env} not in permitted_environments`);
      } else if (accessIn(principal.roles, env) === 'none') {
        await denyFor(app, deps.sql, principal, req, `no role grants access to ${env}`);
      }
    }

    const required = req.routeOptions.config.requiredRole;
    if (required && !principal.roles.includes(required)) {
      await denyFor(app, deps.sql, principal, req, `role ${required} required`);
    }
  });
}

async function denyFor(
  app: FastifyInstance,
  sql: postgres.Sql,
  principal: Principal,
  req: FastifyRequest,
  reason: string,
): Promise<never> {
  // Attributed denial row — own tenant-scoped tx; never mask the 403.
  try {
    await withTenantTx(sql, principal.tenantId, (tx) =>
      record(tx, principal, {
        action: AUDIT_ACTIONS.authDenied,
        detail: { method: req.method, path: req.url, reason },
      }),
    );
  } catch (e) {
    app.log.error({ err: e }, 'auth.denied audit write failed');
  }
  throw forbidden(reason);
}

/** Route-level shorthand for config.requiredRole. */
export function requireRole(role: Role) {
  return { config: { requiredRole: role } };
}
