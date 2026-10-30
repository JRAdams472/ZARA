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

function isDenied(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_]/g, '');
  if (EXACT.has(k)) return true;
  return CREDENTIAL_SUBSTRINGS.some((s) => k.includes(s));
}

/** Deep-clone `value` with denied keys rewritten to `[MASKED]`.
 *  Objects and arrays are walked recursively; scalars pass through.
 *  Matching is on the KEY name — a denied key's whole subtree is masked. */
export function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isDenied(k) ? MASK : maskDeep(v);
    }
    return out;
  }
  return value;
}
