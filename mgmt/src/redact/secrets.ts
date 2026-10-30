//! Role→field-visibility map applied AT SERIALIZATION (ADR-0005). The
//! map is versioned in code — a caller's view can only change by
//! deliberate review. Secrets metadata is the proof surface:
//!   release manager → keyVersion + updatedBy (full metadata)
//!   rule engineer   → minus updatedBy (redacted)
//!   auditor         → none (403 — tenant config isn't rule scope)

import { envelopeVersion, isEnvelope } from '../kms/cipher.js';
import type { Role } from '../auth/roles.js';
import type { SecretRow } from '../db/secrets.js';

export const SECRETS_VIEW_VERSION = 1;

export type SecretView = 'full' | 'redacted' | 'none';

/** Highest visibility any of `roles` holds on secret metadata. */
export function secretView(roles: readonly Role[]): SecretView {
  if (roles.includes('tenant_release_manager')) return 'full';
  if (roles.includes('tenant_rule_engineer')) return 'redacted';
  return 'none';
}

/** Wire shape — ciphertext and plaintext NEVER appear here. */
export interface SecretMeta {
  name: string;
  keyName: string;
  keyVersion: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

/** Serialize one row for `view`; asserts 'none' was denied upstream. */
export function serializeSecret(view: Exclude<SecretView, 'none'>, row: SecretRow): SecretMeta {
  const keyVersion = isEnvelope(row.ciphertext)
    ? (envelopeVersion(row.ciphertext) ?? 'unknown')
    : 'unknown';
  const meta: SecretMeta = {
    name: row.name,
    keyName: row.keyName,
    keyVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (view === 'full') meta.updatedBy = row.updatedBy;
  return meta;
}
