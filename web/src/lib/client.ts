//! Client-side fetchers — hit the same-origin /bff proxy; the session
//! bearer never reaches the browser. A 401 means the session is gone:
//! send the user back through login.

import type {
  Env,
  PromotionRow,
  RuleDetail,
  RuleMeta,
  Whoami,
} from './types';

const BFF = '/bff';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BFF}${path}`);
  if (res.status === 401) {
    window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('unauthenticated');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const endpoints = {
  whoami: () => apiGet<Whoami>('/api/whoami'),
  rules: (env: Env) => apiGet<{ rules: RuleMeta[] }>(`/api/envs/${env}/rules`),
  rule: (env: Env, key: string) =>
    apiGet<{ rule: RuleDetail }>(`/api/envs/${env}/rules/${encodeURIComponent(key)}`),
  promotions: (env: Env) =>
    apiGet<{ promotions: PromotionRow[] }>(`/api/envs/${env}/promotions`),
};
