import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { genChallenge, genState, genVerifier } from '@/lib/pkce';

const b64urlRe = /^[A-Za-z0-9_-]+$/;

describe('pkce', () => {
  it('verifier is 43-char base64url (32 random bytes)', () => {
    const v = genVerifier();
    expect(v).toHaveLength(43);
    expect(v).toMatch(b64urlRe);
  });

  it('challenge is the S256 transform of the verifier', () => {
    const v = genVerifier();
    const expected = createHash('sha256')
      .update(v)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(genChallenge(v)).toBe(expected);
  });

  it('verifier and state are unpredictable across calls', () => {
    expect(genVerifier()).not.toBe(genVerifier());
    expect(genState()).not.toBe(genState());
  });
});
