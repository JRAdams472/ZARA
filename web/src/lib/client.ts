//! Client-side fetchers — hit the same-origin /bff proxy; the session
//! bearer never reaches the browser. A 401 means the session is gone:
//! send the user back through login.

import type {
  AuditEvent,
  AuditVerifyResult,
  Env,
  GrantRow,
  PromoteResult,
  PromotionRow,
  RuleDetail,
  RuleMeta,
  Whoami,
} from './types';

const BFF = '/bff';

/** Carries mgmt's status + message verbatim — PII-guard and JDM-shape
 *  400s must reach the form as the server wrote them. */
export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BFF}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 401) {
    window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ClientApiError(401, 'unauthenticated');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ClientApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const apiGet = <T>(path: string) => bff<T>(path);

export const endpoints = {
  whoami: () => apiGet<Whoami>('/api/whoami'),
  rules: (env: Env) => apiGet<{ rules: RuleMeta[] }>(`/api/envs/${env}/rules`),
  rule: (env: Env, key: string) =>
    apiGet<{ rule: RuleDetail }>(`/api/envs/${env}/rules/${encodeURIComponent(key)}`),
  promotions: (env: Env) =>
    apiGet<{ promotions: PromotionRow[] }>(`/api/envs/${env}/promotions`),
  // Mutations — mgmt enforces DEV-only + dev-write server-side; the UI
  // gates affordances but never trusts them.
  createRule: (env: Env, body: { key: string; kind: string; spec: unknown }) =>
    bff<{ key: string }>(`/api/envs/${env}/rules`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  saveRule: (env: Env, key: string, spec: unknown) =>
    bff<{ key: string }>(`/api/envs/${env}/rules/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ spec }),
    }),
  deleteRule: (env: Env, key: string) =>
    bff<{ deleted: string }>(`/api/envs/${env}/rules/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),
  publishRule: (env: Env, key: string) =>
    bff<{ key: string; sha256: string }>(
      `/api/envs/${env}/rules/${encodeURIComponent(key)}/publish`,
      { method: 'POST' },
    ),
  /** Target is derived server-side (dev→qa→uat→prod); env here is the
   *  source lane. `published` reflects the best-effort engine push —
   *  the poller converges either way. */
  promoteRule: (env: Env, key: string) =>
    bff<PromoteResult>(`/api/envs/${env}/rules/${encodeURIComponent(key)}/promote`, {
      method: 'POST',
    }),
  // Tenant admin — RM-only routes; server 403s for anyone else.
  grants: () => apiGet<{ grants: GrantRow[] }>('/api/admin/grants'),
  putGrant: (body: { subjectType: string; subject: string; role: string }) =>
    bff<{ grant: GrantRow }>('/api/admin/grants', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteGrant: (id: string) =>
    bff<{ revoked: GrantRow }>(`/api/admin/grants/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  auditEvents: (limit = 100) =>
    apiGet<{ events: AuditEvent[] }>(`/api/admin/audit?limit=${limit}`),
  verifyAudit: () => apiGet<AuditVerifyResult>('/api/admin/audit/verify'),
};
