//! FieldCipher seam — envelope grammar, transit request shape (mocked
//! fetch), and failure mapping to 503 / 400. No live KMS needed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  envelopeVersion,
  isEnvelope,
  KmsUnavailableError,
} from '../../src/kms/cipher.js';
import { TransitCipher } from '../../src/kms/transit.js';

const OPTS = {
  url: 'http://bao.test:8200',
  token: 'test-token',
  mount: 'zara-transit',
  keyName: 'zara-mgmt-secrets',
};

describe('envelope grammar', () => {
  it('accepts vault:vN: envelopes', () => {
    expect(isEnvelope('vault:v1:aGk=')).toBe(true);
    expect(isEnvelope('vault:v42:AAAA==')).toBe(true);
    expect(envelopeVersion('vault:v42:AAAA==')).toBe('42');
  });
  it('rejects non-envelopes', () => {
    for (const s of ['', 'plaintext', 'vault:x:abc', 'vault:v1:', 'v1:abc', 'vault:v1']) {
      expect(isEnvelope(s), s).toBe(false);
    }
    expect(envelopeVersion('nope')).toBeUndefined();
  });
});

describe('TransitCipher', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200 });

  it('encrypt posts b64 plaintext and returns the envelope', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return reply({ ciphertext: 'vault:v1:ZW5j' });
    });
    const c = new TransitCipher(OPTS);
    const out = await c.encrypt('s3cr3t');
    expect(out).toBe('vault:v1:ZW5j');
    expect(calls[0]?.url).toBe('http://bao.test:8200/v1/zara-transit/encrypt/zara-mgmt-secrets');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-vault-token']).toBe('test-token');
    const body = JSON.parse(calls[0]?.init.body as string) as { plaintext: string };
    expect(Buffer.from(body.plaintext, 'base64').toString('utf8')).toBe('s3cr3t');
  });

  it('decrypt round-trips through the transit shape', async () => {
    vi.stubGlobal('fetch', async () =>
      reply({ plaintext: Buffer.from('s3cr3t', 'utf8').toString('base64') }),
    );
    const c = new TransitCipher(OPTS);
    expect(await c.decrypt('vault:v1:ZW5j')).toBe('s3cr3t');
  });

  it('rewrap returns the new envelope without plaintext', async () => {
    vi.stubGlobal('fetch', async (_u: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { ciphertext: string };
      expect(body.ciphertext).toBe('vault:v1:ZW5j');
      expect(JSON.stringify(body)).not.toContain('s3cr3t');
      return reply({ ciphertext: 'vault:v2:bmV3' });
    });
    const c = new TransitCipher(OPTS);
    expect(await c.rewrap('vault:v1:ZW5j')).toBe('vault:v2:bmV3');
  });

  it('rejects non-envelope inputs to decrypt/rewrap before any call', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const c = new TransitCipher(OPTS);
    await expect(c.decrypt('garbage')).rejects.toMatchObject({ statusCode: 400 });
    await expect(c.rewrap('garbage')).rejects.toMatchObject({ statusCode: 400 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps transit errors + unreachable to 503', async () => {
    vi.stubGlobal('fetch', async () => new Response('sealed', { status: 503 }));
    const c = new TransitCipher(OPTS);
    await expect(c.encrypt('x')).rejects.toBeInstanceOf(KmsUnavailableError);
    vi.stubGlobal('fetch', async () => {
      throw new Error('conn refused');
    });
    await expect(c.encrypt('x')).rejects.toBeInstanceOf(KmsUnavailableError);
  });

  it('503s when neither token nor token file is configured', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const c = new TransitCipher({ url: OPTS.url, mount: OPTS.mount, keyName: OPTS.keyName });
    await expect(c.encrypt('x')).rejects.toBeInstanceOf(KmsUnavailableError);
  });

  it('rejects malformed envelopes coming back from the KMS', async () => {
    vi.stubGlobal('fetch', async () => reply({ ciphertext: 'not-an-envelope' }));
    const c = new TransitCipher(OPTS);
    await expect(c.encrypt('x')).rejects.toBeInstanceOf(KmsUnavailableError);
  });
});
