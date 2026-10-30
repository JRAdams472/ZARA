//! JDM graph handling at the authoring boundary (ADR-0003-adjacent:
//! spec IS the JDM document for the MVP — Z5's @gorules/jdm-editor
//! authors it natively). "Compile" = validate shape + canonicalize to a
//! deterministic JSON form; sha256 is computed in Postgres over
//! `jdm::text` so it can never drift from the seed hashing convention.

import { badRequest } from '../plugins/errors.js';

export const RULE_KINDS = ['base_fee', 'adjustment_set'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export function isRuleKind(s: string): s is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(s);
}

export const RULE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** GoRules JDM documents carry `nodes` + `edges` arrays — the engine's
 *  zen-engine rejects anything else at eval time, so reject it at the
 *  boundary instead (a bad graph must never become a published row). */
export function assertJdmShape(spec: unknown): asserts spec is Record<string, unknown> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw badRequest('spec must be a JDM graph object');
  }
  const s = spec as Record<string, unknown>;
  if (!Array.isArray(s.nodes) || !Array.isArray(s.edges)) {
    throw badRequest('spec must be a JDM graph ({nodes:[], edges:[]})');
  }
  for (const n of s.nodes) {
    if (!n || typeof n !== 'object' || typeof (n as { id?: unknown }).id !== 'string') {
      throw badRequest('every JDM node needs a string id');
    }
  }
}

/** Deterministic JSON — sorted keys at every level (same canonicalizer
 *  the audit chain uses; identical inputs always produce identical text
 *  and therefore identical sha256). */
export function canonicalize(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
