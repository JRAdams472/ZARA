//! Pino-level redaction (ADR-0005) — two layers, both versioned in code:
//!   1. LOG_FORMATTERS runs the mask.ts denylist walker over every log
//!      object — structural any-depth coverage that nesting can't dodge.
//!   2. LOG_REDACT keeps transport-carrier paths (auth header, cookies)
//!      plus top-level/near-depth spellings for pino's own censor pass.
//! Shared by app.ts and the log-output test so the proven surface IS the
//! shipped surface.

import { MASK, maskDeep } from './mask.js';

const DENIED_SPELLINGS = [
  'ssn',
  'tax_id',
  'taxId',
  'client_name',
  'clientName',
  'password',
  'passphrase',
  'secret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'api_key',
  'apiKey',
  'private_key',
  'privateKey',
  'credentials',
  'authorization',
  'cookie',
  'set-cookie',
  'setCookie',
  'x-vault-token',
  'value', // secrets PUT body field — plaintext must never log
  'plaintext',
  'ciphertext',
];

export const LOG_REDACT: { paths: string[]; censor: string } = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-vault-token"]',
    'res.headers["set-cookie"]',
    // `*` matches exactly one segment in fast-redact — depth 0 + 1
    // spellings; anything deeper is handled by LOG_FORMATTERS below.
    ...DENIED_SPELLINGS.flatMap((k) => [k, `*.${k}`]),
  ],
  censor: MASK,
};

// Structural layer: every logged object is walked by the versioned
// denylist — a `ssn` at any depth masks regardless of path spelling.
export const LOG_FORMATTERS = {
  log: (o: Record<string, unknown>) => maskDeep(o) as Record<string, unknown>,
};
