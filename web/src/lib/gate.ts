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
