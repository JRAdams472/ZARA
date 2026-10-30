//! Log-output proof (ADR-0005 acceptance): a real pino instance with the
//! shipped LOG_REDACT config writes [MASKED] for ssn / tax_id /
//! client_name / apiKey — not the values.

import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { LOG_FORMATTERS, LOG_REDACT } from '../../src/log/redact.js';
import { MASK } from '../../src/log/mask.js';

function capture(): { stream: Writable; lines: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += String(chunk);
      cb();
    },
  });
  return { stream, lines: () => buf };
}

describe('pino redaction (shipped config)', () => {
  it('masks identity + credential fields at any depth', () => {
    const { stream, lines } = capture();
    const log = pino(
      { level: 'info', redact: LOG_REDACT, formatters: LOG_FORMATTERS },
      stream,
    );
    log.info({
      msg: 'test',
      borrower: { ssn: '123-45-6789', tax_id: '12-3456789', client_name: 'Jane Doe' },
      apiKey: 'super-api-key',
      nested: { deep: { password: 'pw', refreshToken: 'rt' } },
      keep: 'visible',
    });
    const out = lines();
    expect(out).toContain(`"${MASK}"`);
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('12-3456789');
    expect(out).not.toContain('Jane Doe');
    expect(out).not.toContain('super-api-key');
    expect(out).not.toContain('pw');
    expect(out).not.toContain('rt');
    expect(out).toContain('visible');
  });

  it('masks the secrets PUT body field + auth header', () => {
    const { stream, lines } = capture();
    const log = pino(
      { level: 'info', redact: LOG_REDACT, formatters: LOG_FORMATTERS },
      stream,
    );
    log.info({
      req: { headers: { authorization: 'Bearer topsecret' } },
      value: 's3cr3t-plaintext',
      ciphertext: 'vault:v1:abc',
    });
    const out = lines();
    expect(out).not.toContain('topsecret');
    expect(out).not.toContain('s3cr3t-plaintext');
    expect(out).not.toContain('vault:v1:abc');
  });
});
