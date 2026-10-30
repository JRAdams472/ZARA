import { loadConfig } from './config.js';
import { JwtValidator } from './auth/jwks.js';
import { createPool } from './db/pool.js';
import { createCipher } from './kms/index.js';
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

const app = await buildApp(cfg, { sql, validator, ...(cipher ? { cipher } : {}) });
await app.listen({ port: cfg.port, host: '::' });
