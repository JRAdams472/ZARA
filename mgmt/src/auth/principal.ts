//! The authenticated caller: verified token claims + roles resolved from
//! `role_grants` (the IdP never knows Zara roles). Claims supply identity;
//! grants supply authorization — a token alone grants nothing.

import type { JWTPayload } from 'jose';
import type postgres from 'postgres';
import { scopedEnvs, type Env, type Role } from './roles.js';
import { withTenantTx } from '../db/pool.js';

export interface Principal {
  sub: string;
  tenantId: string;
  /** `permitted_environments` claim, lowercase-normalized. */
  permittedEnvs: string[];
  email?: string;
  /** Claim `aud` values — identity keys for `aud`-type grants. */
  audiences: string[];
  roles: Role[];
  /** permittedEnvs ∩ role scope — what this caller may actually touch. */
  effectiveEnvs: Env[];
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

interface CacheEntry {
  roles: Role[];
  at: number;
}
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, CacheEntry>();

/** Resolve a principal's roles: union of grants across identity keys
 *  ('sub'|sub, 'email'|email, 'aud'|each aud) for the caller's tenant.
 *  Briefly cached — revocation lands on the next request after TTL. */
async function resolveRoles(
  sql: postgres.Sql,
  tenantId: string,
  keys: [string, string][],
): Promise<Role[]> {
  const cacheKey = `${tenantId}:${keys.map(([t, s]) => `${t}:${s}`).sort().join(',')}`;
  const hit = roleCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ROLE_CACHE_TTL_MS) return hit.roles;

  const types = keys.map(([t]) => t);
  const subjects = keys.map(([, s]) => s);
  const roles = await withTenantTx(sql, tenantId, async (tx) => {
    const rows = await tx<{ role: string }[]>`
      SELECT DISTINCT role FROM zara_control.role_grants
       WHERE (subject_type, subject) IN (
         SELECT * FROM unnest(${types}::text[], ${subjects}::text[]))`;
    return rows.map((r) => r.role as Role);
  });
  roleCache.set(cacheKey, { roles, at: Date.now() });
  return roles;
}

/** Test hook — drops the grants cache. */
export function clearRoleCache(): void {
  roleCache.clear();
}

/** Verified JWT payload → Principal. `tenant_id` and
 *  `permitted_environments` are required — deny-first. */
export async function principalFromClaims(
  sql: postgres.Sql,
  payload: JWTPayload,
): Promise<Principal> {
  if (!payload.sub) throw new AuthError('missing sub');
  const tenantId = payload.tenant_id;
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new AuthError('missing tenant_id claim');
  }
  const envs = payload.permitted_environments;
  if (!Array.isArray(envs) || envs.length === 0) {
    throw new AuthError('token carries no permitted_environments');
  }
  const permittedEnvs = envs
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.toLowerCase());
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : [];

  const keys: [string, string][] = [['sub', payload.sub]];
  if (email) keys.push(['email', email]);
  for (const a of audiences) keys.push(['aud', a]);

  const roles = await resolveRoles(sql, tenantId, keys);
  const permitted = new Set(permittedEnvs);
  const effectiveEnvs = scopedEnvs(roles).filter((e) => permitted.has(e));
  return {
    sub: payload.sub,
    tenantId,
    permittedEnvs,
    ...(email ? { email } : {}),
    audiences,
    roles,
    effectiveEnvs,
  };
}
