//! Secrets admin — ciphertext-only persistence, metadata-only reads
//! (ADR-0003). Writes are Release-Manager mutations; reads redact per
//! the role→field map (auditors get an attributed 403). The cipher seam
//! sits between the route and the row: nothing on this surface can ever
//! emit plaintext or ciphertext.

import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import { record, AUDIT_ACTIONS } from '../db/audit.js';
import { withTenantTx } from '../db/pool.js';
import {
  getSecretTx,
  listSecretsWithCiphertextTx,
  updateCiphertextTx,
  upsertSecretTx,
} from '../db/secrets.js';
import type { FieldCipher } from '../kms/cipher.js';
import { KmsUnavailableError } from '../kms/cipher.js';
import { badRequest, forbidden, notFound } from '../plugins/errors.js';
import { requireRole } from '../plugins/auth.js';
import { secretView, serializeSecret } from '../redact/secrets.js';

const RM = requireRole('tenant_release_manager');
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const putSchema = {
  body: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: {
      value: { type: 'string', minLength: 1, maxLength: 8192 },
    },
  },
} as const;

export function registerSecrets(
  app: FastifyInstance,
  sql: postgres.Sql,
  cipher: FieldCipher | undefined,
): void {
  const needCipher = (): FieldCipher => {
    if (!cipher) throw new KmsUnavailableError();
    return cipher;
  };

  // Metadata list — RBAC-scoped serialization; auditor denied.
  app.get('/api/admin/secrets', async (req) => {
    const p = req.principal;
    const view = secretView(p.roles);
    if (view === 'none') {
      try {
        await withTenantTx(sql, p.tenantId, (tx) =>
          record(tx, p, {
            action: AUDIT_ACTIONS.authDenied,
            detail: { method: req.method, path: req.url, reason: 'secrets metadata not in role scope' },
          }),
        );
      } catch (e) {
        app.log.error({ err: e }, 'auth.denied audit write failed');
      }
      throw forbidden('secrets metadata not in role scope');
    }
    needCipher(); // every secrets route 503s on unset KMS — no degraded metadata mode
    const rows = await withTenantTx(sql, p.tenantId, (tx) =>
      listSecretsWithCiphertextTx(tx),
    );
    return { secrets: rows.map((r) => serializeSecret(view, r)) };
  });

  // Create/rotate a secret value — encrypt → upsert → audit, one tx.
  app.put('/api/admin/secrets/:name', { ...RM, schema: putSchema }, async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!NAME_RE.test(name)) throw badRequest('invalid secret name');
    const { value } = req.body as { value: string };
    const c = needCipher();
    const p = req.principal;
    // Encrypt OUTSIDE the tx — no plaintext lifetime extension, no KMS
    // call holding a DB lock.
    const ciphertext = await c.encrypt(value);
    await withTenantTx(sql, p.tenantId, async (tx) => {
      await upsertSecretTx(tx, { name, ciphertext, keyName: c.keyName, updatedBy: p.sub });
      await record(tx, p, {
        action: AUDIT_ACTIONS.secretPut,
        detail: { name }, // name only — never the value
      });
    });
    return reply.code(200).send({ name });
  });

  // Rewrap under the key's latest version — rotation support. Reads the
  // envelope inside the tx, calls transit rewrap (no plaintext on the
  // wire), commits the new envelope + audit row.
  app.post('/api/admin/secrets/:name/rewrap', RM, async (req) => {
    const { name } = req.params as { name: string };
    if (!NAME_RE.test(name)) throw badRequest('invalid secret name');
    const c = needCipher();
    const p = req.principal;
    const updated = await withTenantTx(sql, p.tenantId, async (tx) => {
      const row = await getSecretTx(tx, name);
      if (!row) return false;
      const rewrapped = await c.rewrap(row.ciphertext);
      const ok = await updateCiphertextTx(tx, { name, ciphertext: rewrapped, updatedBy: p.sub });
      if (!ok) return false;
      await record(tx, p, {
        action: AUDIT_ACTIONS.secretRewrap,
        detail: { name },
      });
      return true;
    });
    if (!updated) throw notFound('secret not found');
    return { name, rewrapped: true };
  });
}
