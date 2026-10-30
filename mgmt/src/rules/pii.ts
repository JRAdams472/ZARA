//! Write-path PII guard — the engine's pii_guard invariant applied at
//! authoring: rule specs carry loan/scenario attributes only. Rejects
//! with the FIELD PATH only (never the value — that's the leak).

import { badRequest } from '../plugins/errors.js';
import { isDeniedKey } from '../log/mask.js';

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const BARE_SSN_RE = /^\s*\d{9}\s*$/;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

function fail(path: string): never {
  throw badRequest(`PII-class field rejected at ${path}`);
}

/** Recursive walk — denied key names OR PII-shaped string values fail. */
export function assertNoPii(value: unknown, path = 'spec'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => { assertNoPii(v, `${path}[${String(i)}]`); });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (isDeniedKey(k)) fail(p);
      assertNoPii(v, p);
    }
    return;
  }
  if (typeof value === 'string' && (SSN_RE.test(value) || BARE_SSN_RE.test(value) || EMAIL_RE.test(value))) {
    fail(path);
  }
}
