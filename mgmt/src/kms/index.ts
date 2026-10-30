//! KMS wiring — `createCipher` returns `undefined` when KMS_URL is
//! unset; secrets routes then answer 503 while the rest of the service
//! stays up (never an insecure local fallback — ADR-0003).

import type { Config } from '../config.js';
import type { FieldCipher } from './cipher.js';
import { TransitCipher } from './transit.js';

export { type FieldCipher, isEnvelope, envelopeVersion, KmsUnavailableError } from './cipher.js';
export { TransitCipher } from './transit.js';

export function createCipher(cfg: Config): FieldCipher | undefined {
  if (!cfg.kms) return undefined;
  return new TransitCipher({
    url: cfg.kms.url,
    ...(cfg.kms.tokenFile ? { tokenFile: cfg.kms.tokenFile } : {}),
    ...(cfg.kms.token ? { token: cfg.kms.token } : {}),
    mount: cfg.kms.mount,
    keyName: cfg.kms.keyName,
  });
}
