import { loadConfig } from './config.js';
import { JwtValidator } from './auth/jwks.js';
import { createPool } from './db/pool.js';
import { createCipher } from './kms/index.js';
import { createEnginePublisher } from './grpc/publish.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const sql = createPool(cfg.databaseUrl);

let validator: JwtValidator;
if (cfg.staticJwks) {
  validator = JwtValidator.forStatic(cfg.staticJwks, {
    ...(cfg.oidcIssuer ? { issuer: cfg.oidcIssuer } : {}),
    audience: cfg.oidcAudience,
  });
} else {
  // loadConfig already enforces issuer when no static JWKS is set.
  if (!cfg.oidcIssuer) throw new Error('OIDC_ISSUER required without static JWKS');
  validator = await JwtValidator.connect(cfg.oidcIssuer, cfg.oidcAudience, cfg.oidcJwksUrl);
}

if (cfg.staticJwks) {
  console.warn('static JWKS configured (ZARA_JWKS_JSON/ZARA_JWKS_FILE) — dev/test only, never prod');
}

const cipher = createCipher(cfg);
if (!cipher) {
  console.warn('KMS_URL unset — secrets routes will answer 503 (no local fallback, ADR-0003)');
}
const rulesSql = cfg.rulesDatabaseUrl ? createPool(cfg.rulesDatabaseUrl) : undefined;
const promoteSql = cfg.promoteDatabaseUrl ? createPool(cfg.promoteDatabaseUrl) : undefined;
if (!rulesSql || !promoteSql) {
  console.warn('RULES_/PROMOTE_DATABASE_URL unset — rule + promotion routes will answer 503');
}
const enginePublisher = createEnginePublisher(cfg);
if (!enginePublisher) {
  console.warn('ENGINE_GRPC_ADDR unset — promotions report published:false (poller converges, ADR-0004)');
}

const app = await buildApp(cfg, {
  sql,
  validator,
  ...(cipher ? { cipher } : {}),
  ...(rulesSql ? { rulesSql } : {}),
  ...(promoteSql ? { promoteSql } : {}),
  ...(enginePublisher ? { enginePublisher } : {}),
});
await app.listen({ port: cfg.port, host: '::' });
