//! OpenBao transit adapter (LOLA OpenBaoTransitClient port — deliberately
//! thin and auditable). Key material never leaves OpenBao; the only
//! secret crossing the wire is the auth token. Transit `aes256-gcm96`
//! keys provide the AES-256-GCM field encryption ADR-0003 requires.

import { readFile } from 'node:fs/promises';
import { badRequest, HttpError } from '../plugins/errors.js';
import {
  type FieldCipher,
  isEnvelope,
  KmsUnavailableError,
} from './cipher.js';

export interface TransitOptions {
  /** Base URL, e.g. `http://openbao:8200`. */
  url: string;
  /** File holding the scoped mgmt token (read lazily, cached). */
  tokenFile?: string;
  /** Inline token — test/CI convenience; file wins when both set. */
  token?: string;
  /** Transit mount path. */
  mount: string;
  /** Transit key sealing these fields. */
  keyName: string;
  /** Per-request timeout (default 5 s — the service must never hang on
   *  a dead KMS). */
  timeoutMs?: number;
}

const B64 = {
  enc: (s: string) => Buffer.from(s, 'utf8').toString('base64'),
  dec: (b64: string) => Buffer.from(b64, 'base64').toString('utf8'),
};

export class TransitCipher implements FieldCipher {
  readonly keyName: string;
  private tokenCache?: string;

  constructor(private readonly opts: TransitOptions) {
    this.keyName = opts.keyName;
  }

  async encrypt(plaintext: string): Promise<string> {
    const data = await this.post(`encrypt/${this.opts.keyName}`, {
      plaintext: B64.enc(plaintext),
    });
    const ct = data.ciphertext;
    if (typeof ct !== 'string' || !isEnvelope(ct)) {
      throw new KmsUnavailableError('KMS returned a malformed envelope');
    }
    return ct;
  }

  async decrypt(envelope: string): Promise<string> {
    if (!isEnvelope(envelope)) throw badRequest('not a vault:vN: envelope');
    const data = await this.post(`decrypt/${this.opts.keyName}`, {
      ciphertext: envelope,
    });
    if (typeof data.plaintext !== 'string') {
      throw new KmsUnavailableError('KMS returned no plaintext');
    }
    return B64.dec(data.plaintext);
  }

  async rewrap(envelope: string): Promise<string> {
    if (!isEnvelope(envelope)) throw badRequest('not a vault:vN: envelope');
    const data = await this.post(`rewrap/${this.opts.keyName}`, {
      ciphertext: envelope,
    });
    const ct = data.ciphertext;
    if (typeof ct !== 'string' || !isEnvelope(ct)) {
      throw new KmsUnavailableError('KMS returned a malformed envelope');
    }
    return ct;
  }

  private async token(): Promise<string> {
    if (this.opts.tokenFile) {
      // Cached after first read; a rotated dev token takes effect on
      // restart — acceptable for the dev KMS path.
      this.tokenCache ??= (await readFile(this.opts.tokenFile, 'utf8')).trim();
      if (this.tokenCache) return this.tokenCache;
    }
    if (this.opts.token) return this.opts.token;
    throw new KmsUnavailableError('KMS token not configured');
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    let resp: Response;
    try {
      resp = await fetch(`${this.opts.url.replace(/\/+$/, '')}/v1/${this.opts.mount}/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vault-token': await this.token(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new KmsUnavailableError('KMS unreachable');
    }
    const text = await resp.text();
    if (!resp.ok) {
      // OpenBao error bodies can echo the request — never surface them;
      // they could carry ciphertext or policy details.
      throw new KmsUnavailableError(`KMS request failed (${String(resp.status)})`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new KmsUnavailableError('KMS returned malformed JSON');
    }
    const data = (parsed as { data?: unknown }).data;
    if (!data || typeof data !== 'object') {
      throw new KmsUnavailableError('KMS response had no data');
    }
    return data as Record<string, unknown>;
  }
}
