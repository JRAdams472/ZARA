//! UI affordance gates — computed from verified whoami claims and used
//! to decide which mutation controls render. mgmt is still the
//! enforcement point; these only decide what the user sees.

import type { Env, Whoami } from './types';

/** Rule mutations exist only on DEV and require dev-write. */
export function canWriteEnv(who: Whoami, env: Env): boolean {
  return env === 'dev' && who.envAccess.dev === 'write';
}

/** A draft on DEV under dev-write is editable; anything published or
 *  outside DEV is read-only regardless of role. */
export function canEditRule(who: Whoami, env: Env, status: 'draft' | 'published'): boolean {
  return canWriteEnv(who, env) && status === 'draft';
}

/** Promotion chain — adjacent steps only, matching mgmt `nextEnv`. */
const NEXT_ENV: Record<Env, Env | undefined> = {
  dev: 'qa',
  qa: 'uat',
  uat: 'prod',
  prod: undefined,
};

/** Environment this env promotes into, or undefined for PROD. */
export function nextEnv(env: Env): Env | undefined {
  return NEXT_ENV[env];
}

/** Mirrors mgmt `canPromote`: RM → any target; engineer → everything
 *  except PROD; auditor → nothing. UI hides the affordance — the server
 *  enforces the same check independently. */
export function canPromoteInto(who: Whoami, toEnv: Env): boolean {
  if (who.roles.includes('tenant_release_manager')) return true;
  if (who.roles.includes('tenant_rule_engineer')) return toEnv !== 'prod';
  return false;
}

/** Promotion target the caller may act on from `env`, or null when the
 *  affordance must not render (no successor, or role lacks scope). */
export function promoteTargetFor(who: Whoami, env: Env): Env | null {
  const to = nextEnv(env);
  return to && canPromoteInto(who, to) ? to : null;
}

/** Tenant-admin surfaces are Release-Manager-only (grants, audit). */
export function isReleaseManager(who: Whoami): boolean {
  return who.roles.includes('tenant_release_manager');
}

/** Canonical JSON — same key-sorted serialization mgmt applies before
 *  hashing/storing a spec. Used to tell "the editor emitted its loaded
 *  graph on mount" apart from a real user edit. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
