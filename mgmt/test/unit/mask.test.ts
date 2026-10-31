//! mask.ts — ADR-0005 denylist proof: ssn / tax_id / client_name /
//! credential-shaped keys rewrite to [MASKED] at every depth.

import { describe, expect, it } from 'vitest';
import { MASK, MASK_DENYLIST_VERSION, maskDeep } from '../../src/log/mask.js';

describe('maskDeep', () => {
  it('masks identity fields', () => {
    const out = maskDeep({
      ssn: '123-45-6789',
      tax_id: '12-3456789',
      client_name: 'Jane Doe',
      loan_amount: 400000,
    }) as Record<string, unknown>;
    expect(out.ssn).toBe(MASK);
    expect(out.tax_id).toBe(MASK);
    expect(out.client_name).toBe(MASK);
    expect(out.loan_amount).toBe(400000);
  });

  it('masks credential-shaped keys incl. camelCase', () => {
    const out = maskDeep({
      apiKey: 'k',
      api_key: 'k',
      clientSecret: 's',
      refreshToken: 't',
      password: 'p',
      credentials: 'c',
      authorization: 'Bearer x',
      private_key: 'pk',
      setCookie: 'c',
    }) as Record<string, unknown>;
    for (const k of Object.keys(out)) expect(out[k], k).toBe(MASK);
  });

  it('walks nested objects and arrays', () => {
    const out = maskDeep({
      borrower: { ssn: 'x', name: 'n' },
      list: [{ tax_id: 'y' }, { ok: 1 }],
    }) as { borrower: { ssn: string; name: string }; list: { tax_id?: string; ok?: number }[] };
    expect(out.borrower.ssn).toBe(MASK);
    expect(out.borrower.name).toBe('n');
    expect(out.list[0]?.tax_id).toBe(MASK);
    expect(out.list[1]?.ok).toBe(1);
  });

  it('does not mask non-denylist keys (keyName, name stay visible)', () => {
    const out = maskDeep({
      name: 'dex-client-secret',
      keyName: 'zara-mgmt-secrets',
      keyVersion: '3',
      value: 'v', // pino path-redact covers bodies; mask() is key-driven
    }) as Record<string, unknown>;
    expect(out.name).toBe('dex-client-secret');
    expect(out.keyName).toBe('zara-mgmt-secrets');
    expect(out.keyVersion).toBe('3');
    expect(out.value).toBe('v');
  });

  it('passes scalars through untouched', () => {
    expect(maskDeep('s')).toBe('s');
    expect(maskDeep(42)).toBe(42);
    expect(maskDeep(null)).toBe(null);
  });

  it('collapses cycles instead of recursing forever', () => {
    // Regression: the log formatter runs this on every log object — a
    // cyclic structure (req/res/err shapes) used to crash the process.
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', back: a };
    a.back = b;
    const out = maskDeep({ req: a, token: 'x' }) as {
      req: { back: { back: string } };
      token: string;
    };
    expect(out.req.back.back).toBe('[Circular]');
    expect(out.token).toBe(MASK);
  });

  it('denylist is versioned', () => {
    expect(MASK_DENYLIST_VERSION).toBeGreaterThanOrEqual(1);
  });
});
