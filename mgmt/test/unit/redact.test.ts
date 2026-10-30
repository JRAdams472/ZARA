//! Role→field visibility (ADR-0005): secrets metadata is the proof
//! surface — RM full, engineer minus updatedBy, auditor none.

import { describe, expect, it } from 'vitest';
import { secretView, serializeSecret } from '../../src/redact/secrets.js';
import type { SecretRow } from '../../src/db/secrets.js';

const ROW: SecretRow = {
  name: 'dex-client-secret',
  ciphertext: 'vault:v3:aGk=',
  keyName: 'zara-mgmt-secrets',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  updatedBy: 'rm-subject',
};

describe('secretView', () => {
  it('release manager → full', () => {
    expect(secretView(['tenant_release_manager'])).toBe('full');
  });
  it('rule engineer → redacted', () => {
    expect(secretView(['tenant_rule_engineer'])).toBe('redacted');
  });
  it('auditor → none', () => {
    expect(secretView(['tenant_auditor'])).toBe('none');
  });
  it('no roles → none', () => {
    expect(secretView([])).toBe('none');
  });
  it('highest visibility wins across roles', () => {
    expect(secretView(['tenant_auditor', 'tenant_release_manager'])).toBe('full');
  });
});

describe('serializeSecret', () => {
  it('full view carries keyVersion + updatedBy, never ciphertext', () => {
    const m = serializeSecret('full', ROW);
    expect(m).toEqual({
      name: 'dex-client-secret',
      keyName: 'zara-mgmt-secrets',
      keyVersion: '3',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      updatedBy: 'rm-subject',
    });
    expect(JSON.stringify(m)).not.toContain('vault:');
    expect(m).not.toHaveProperty('ciphertext');
  });

  it('redacted view drops updatedBy', () => {
    const m = serializeSecret('redacted', ROW);
    expect(m.keyVersion).toBe('3');
    expect(m).not.toHaveProperty('updatedBy');
    expect(m.name).toBe('dex-client-secret');
  });

  it('non-envelope ciphertext reports unknown version', () => {
    const m = serializeSecret('full', { ...ROW, ciphertext: 'not-an-envelope' });
    expect(m.keyVersion).toBe('unknown');
  });
});
