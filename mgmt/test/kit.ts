//! Test signing material + app factory. RSA key is generated per run —
//! test-only, guards nothing.

import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { JwtValidator } from '../src/auth/jwks.js';
import type { Config } from '../src/config.js';
import { createCipher, type FieldCipher } from '../src/kms/index.js';

export const ISSUER = 'https://test-issuer.invalid';
export const AUDIENCE = 'zara-mgmt';
export const ACME = 'aa5ce000-0000-4000-8000-0000000000ac';
export const NORTHSTAR = 'bb0215a0-0000-4000-8000-0000000000b2';

export const TEST_CONFIG: Config = {
  port: 0,
  databaseUrl: process.env.MGMT_DATABASE_URL ?? '',
  ...(process.env.RULES_DATABASE_URL
    ? { rulesDatabaseUrl: process.env.RULES_DATABASE_URL }
    : {}),
  ...(process.env.PROMOTE_DATABASE_URL
    ? { promoteDatabaseUrl: process.env.PROMOTE_DATABASE_URL }
    : {}),
  oidcAudience: [AUDIENCE],
  rateLimitPerMin: 10_000,
  rateLimitMutationsPerMin: 10_000,
  rateLimitDisable: true,
  rateLimitTrustXff: false,
  ...(process.env.KMS_URL
    ? {
        kms: {
          url: process.env.KMS_URL,
          ...(process.env.KMS_TOKEN_FILE ? { tokenFile: process.env.KMS_TOKEN_FILE } : {}),
          ...(process.env.KMS_TOKEN ? { token: process.env.KMS_TOKEN } : {}),
          mount: process.env.KMS_MOUNT ?? 'zara-transit',
          keyName: process.env.KMS_KEY_NAME ?? 'zara-mgmt-secrets',
        },
      }
    : {}),
};

export interface Kit {
  app: FastifyInstance;
  /** Same validator/pool but no cipher — proves unset-KMS 503s. */
  noCipherApp: FastifyInstance;
  sql: postgres.Sql;
  validator: JwtValidator;
  /** zara_app_dev / zara_promote pools — present when their DSNs are set. */
  rulesSql?: postgres.Sql;
  promoteSql?: postgres.Sql;
  /** zara_migrate pool — present when MIGRATE_DATABASE_URL is set. Needed
   *  ONLY for test-artifact cleanup: it owns the env tables, so it can
   *  toggle the immutable-published trigger. */
  migrateSql?: postgres.Sql;
  /** Present when KMS_URL was set at kit build — cipher-backed tests gate on it. */
  cipher?: FieldCipher;
  mint: (opts: MintOpts) => Promise<string>;
}

interface MintOpts {
  tenantId?: string;
  envs?: string[];
  sub?: string;
  ttlSecs?: number;
  alg?: 'RS256' | 'HS256';
  iss?: string;
}

export async function makeKit(): Promise<Kit | undefined> {
  const dsn = process.env.MGMT_DATABASE_URL;
  if (!dsn) return undefined; // caller skips
  const sql = postgres(dsn, { max: 4 });
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-1';
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  const validator = JwtValidator.forStatic(JSON.stringify({ keys: [jwk] }), {
    issuer: ISSUER,
    audience: [AUDIENCE],
  });
  const cipher = createCipher(TEST_CONFIG);
  const rulesSql = TEST_CONFIG.rulesDatabaseUrl ? postgres(TEST_CONFIG.rulesDatabaseUrl, { max: 4 }) : undefined;
  const promoteSql = TEST_CONFIG.promoteDatabaseUrl ? postgres(TEST_CONFIG.promoteDatabaseUrl, { max: 4 }) : undefined;
  const migrateSql = process.env.MIGRATE_DATABASE_URL
    ? postgres(process.env.MIGRATE_DATABASE_URL, { max: 2 })
    : undefined;
  const app = await buildApp(TEST_CONFIG, {
    sql,
    validator,
    ...(cipher ? { cipher } : {}),
    ...(rulesSql ? { rulesSql } : {}),
    ...(promoteSql ? { promoteSql } : {}),
  });
  const noKmsCfg: Config = { ...TEST_CONFIG };
  delete noKmsCfg.kms;
  const noCipherApp = await buildApp(noKmsCfg, { sql, validator });
  const signing = privateKey; // jose signs with the CryptoKey directly

  const mint = async (o: MintOpts) => {
    const jwt = new SignJWT({
      tenant_id: o.tenantId ?? ACME,
      permitted_environments: o.envs ?? ['dev'],
    })
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'test-1' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(o.sub ?? 'test-subject')
      .setIssuedAt()
      .setExpirationTime(`${o.ttlSecs ?? 3600}s`);
    if (o.alg === 'HS256') {
      return jwt.sign(new TextEncoder().encode('whatever-secret'));
    }
    return jwt.sign(signing);
  };
  return {
    app,
    noCipherApp,
    sql,
    validator,
    ...(rulesSql ? { rulesSql } : {}),
    ...(promoteSql ? { promoteSql } : {}),
    ...(migrateSql ? { migrateSql } : {}),
    ...(cipher ? { cipher } : {}),
    mint,
  };
}

/**
 * Delete published test artifacts — the immutable trigger forbids the
 * DELETE outright, so cleanup toggles it in-tx (allowed only because
 * `zara_migrate` OWNS the env tables; no lesser role can do this).
 * Key-scoped per test file: suites run in parallel, so a broad sweep
 * would race. Call from afterAll with the file's own keys.
 */
export async function cleanTestArtifacts(
  migrate: postgres.Sql,
  tenantId: string,
  keys: string[],
): Promise<void> {
  for (const schema of ['zara_dev', 'zara_qa', 'zara_uat', 'zara_prod']) {
    await migrate.begin(async (tx) => {
      // GUC must be set before ANY RLS-touched statement — a bare query
      // on a pooled connection hits the ''-placeholder and errors on
      // ''::uuid rather than returning zero rows.
      await tx`SELECT set_config('zara.tenant_id', ${tenantId}, true)`;
      await tx.unsafe(
        `ALTER TABLE ${schema}.rule_artifacts DISABLE TRIGGER rule_artifacts_immutable_published`,
      );
      await tx.unsafe(
        `DELETE FROM ${schema}.rule_artifacts WHERE key = ANY($1)`,
        [keys],
      );
      await tx.unsafe(
        `ALTER TABLE ${schema}.rule_artifacts ENABLE TRIGGER rule_artifacts_immutable_published`,
      );
    });
  }
}
