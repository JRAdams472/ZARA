//! Typed access to the management plane. Server components call
//! `apiFetch` directly (bearer attached server-side); client components
//! go through the same-origin `/bff` proxy so tokens never reach JS.
//! The web never talks to Postgres or the engine — mgmt is the only hop.

import 'server-only';

import { cfg } from './config';
import { bearerFor } from './bearer';
import { isLive, readSession } from './session';
import type { Env, PromotionRow, RuleDetail, RuleMeta, Whoami } from './types';

export type { Env, EnvAccess, PromotionRow, Role, RuleDetail, RuleMeta, Whoami } from './types';
export { ENVS } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Server-side mgmt call with the session bearer. Read-only cookie access —
 *  safe inside server-component render (no refresh writes here; a stale
 *  token surfaces as 401 and the caller redirects to login). */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await readSession();
  if (!isLive(session)) throw new ApiError(401, 'unauthenticated');
  const bearer = await bearerFor(session);
  const res = await fetch(`${cfg.mgmtUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `mgmt ${res.status}`);
  }
  return (await res.json()) as T;
}

export const mgmt = {
  whoami: () => apiFetch<Whoami>('/api/whoami'),
  rules: (env: Env) => apiFetch<{ rules: RuleMeta[] }>(`/api/envs/${env}/rules`),
  rule: (env: Env, key: string) =>
    apiFetch<{ rule: RuleDetail }>(`/api/envs/${env}/rules/${encodeURIComponent(key)}`),
  promotions: (env: Env) =>
    apiFetch<{ promotions: PromotionRow[] }>(`/api/envs/${env}/promotions`),
};

/** First env the caller may actually use — where `/` sends them. */
export function firstEffectiveEnv(w: Whoami): Env | undefined {
  return w.effectiveEnvs[0];
}
