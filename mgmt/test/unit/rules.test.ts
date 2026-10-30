//! Unit: JDM shape/canonicalizer, write-path PII guard, promote RBAC.

import { describe, expect, it } from 'vitest';
import { assertJdmShape, canonicalize, isRuleKind, RULE_KEY_RE } from '../../src/rules/jdm.js';
import { assertNoPii } from '../../src/rules/pii.js';
import { canPromote, nextEnv } from '../../src/auth/roles.js';

const JDM = { nodes: [{ id: 'in', type: 'inputNode' }], edges: [] };

describe('jdm', () => {
  it('accepts a JDM-shaped graph; rejects malformed input', () => {
    expect(() => { assertJdmShape(JDM); }).not.toThrow();
    for (const bad of [null, 'x', [], { nodes: [] }, { edges: [] }, { nodes: 'x', edges: [] }, { nodes: [{ noId: 1 }], edges: [] }]) {
      expect(() => { assertJdmShape(bad); }, JSON.stringify(bad)).toThrow();
    }
  });
  it('canonicalize is deterministic + sorted', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('key + kind validation', () => {
    expect(RULE_KEY_RE.test('origination')).toBe(true);
    for (const k of ['Bad', 'a b', '', 'x'.repeat(70)]) expect(RULE_KEY_RE.test(k), k).toBe(false);
    expect(isRuleKind('base_fee')).toBe(true);
    expect(isRuleKind('nope')).toBe(false);
  });
});

describe('pii guard', () => {
  it('rejects denylist keys at any depth', () => {
    for (const spec of [
      { ssn: '1' },
      { nested: { taxId: 'x' } },
      { borrower: { client_name: 'n' } },
      { cfg: { apiKey: 'k' } },
    ]) {
      expect(() => { assertNoPii(spec); }, JSON.stringify(spec)).toThrow(/PII/);
    }
  });
  it('rejects PII-shaped string values', () => {
    expect(() => { assertNoPii({ note: 'ssn is 123-45-6789' }); }).toThrow(/PII/);
    expect(() => { assertNoPii({ ref: 'a@b.com' }); }).toThrow(/PII/);
    expect(() => { assertNoPii({ id: '123456789' }); }).toThrow(/PII/);
  });
  it('accepts clean rule content', () => {
    expect(() => { assertNoPii({ nodes: [{ id: 'in', name: 'Loan purpose', field: 'loan.purpose' }], edges: [], amount: 900 }); },
    ).not.toThrow();
  });
});

describe('promote rbac', () => {
  it('chain is strictly adjacent; prod terminates', () => {
    expect(nextEnv('dev')).toBe('qa');
    expect(nextEnv('qa')).toBe('uat');
    expect(nextEnv('uat')).toBe('prod');
    expect(nextEnv('prod')).toBeUndefined();
  });
  it('RM promotes anywhere; engineer only to non-prod; auditor never', () => {
    const RM = ['tenant_release_manager'] as const;
    const ENG = ['tenant_rule_engineer'] as const;
    const AUD = ['tenant_auditor'] as const;
    for (const to of ['qa', 'uat', 'prod'] as const) expect(canPromote(RM, to)).toBe(true);
    expect(canPromote(ENG, 'qa')).toBe(true);
    expect(canPromote(ENG, 'uat')).toBe(true);
    expect(canPromote(ENG, 'prod')).toBe(false);
    for (const to of ['qa', 'uat', 'prod'] as const) expect(canPromote(AUD, to)).toBe(false);
    expect(canPromote([], 'qa')).toBe(false);
    expect(canPromote(['tenant_auditor', 'tenant_rule_engineer'], 'uat')).toBe(true);
    expect(canPromote(['tenant_auditor', 'tenant_rule_engineer'], 'prod')).toBe(false);
  });
});
