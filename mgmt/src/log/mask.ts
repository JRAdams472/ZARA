//! Recursive log/audit masking (ADR-0005). The denylist is VERSIONED IN
//! CODE — it can only change by deliberate review, never config, so a
//! config typo can't silently unmask a field. Masking failures are
//! invariant breakages; extend the list, never route around it.

export const MASK = '[MASKED]';

/** Bump when the denylist changes — cited in reviews and audit notes. */
export const MASK_DENYLIST_VERSION = 1;

// Field-name matching: normalize away `-`/`_` and case so `tax_id`,
// `taxId`, `TAX-ID` all match. Exact-match set for identity fields;
// substring family for credential-shaped names (`apiKey`, `clientSecret`,
// `refreshToken`, `privateKey`, `credential*`, `authorization`, `cookie`,
// `set-cookie`, `x-vault-token`).
const EXACT = new Set([
  'ssn',
  'taxid',
  'clientname',
  'password',
  'secret',
  'token',
  'apikey',
  'passphrase',
  'pin',
]);

const CREDENTIAL_SUBSTRINGS = [
  'credential',
  'secret',
  'token',
  'password',
  'apikey',
  'privatekey',
  'authorization',
  'cookie',
];

/** Exported for the write-path PII guard (rules/pii.ts) — same
 *  normalized denylist the log masker uses. */
export function isDeniedKey(key: string): boolean {
  return isDenied(key);
}

function isDenied(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_]/g, '');
  if (EXACT.has(k)) return true;
  return CREDENTIAL_SUBSTRINGS.some((s) => k.includes(s));
}

/** Deep-clone `value` with denied keys rewritten to `[MASKED]`.
 *  Objects and arrays are walked recursively; scalars pass through.
 *  Matching is on the KEY name — a denied key's whole subtree is masked.
 *  Cycles collapse to '[Circular]' — this walker runs on EVERY log line,
 *  so a cyclic structure must never crash the process. */
export function maskDeep(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((v) => walk(v, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isDenied(k) ? MASK : walk(v, seen);
    }
    return out;
  }
  return value;
}
