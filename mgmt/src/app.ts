import Fastify, { type FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import type { Config } from './config.js';
import type { JwtValidator } from './auth/jwks.js';
import type { FieldCipher } from './kms/index.js';
import { registerAuthGate } from './plugins/auth.js';
import { registerRateLimits } from './plugins/rateLimit.js';
import { registerSecurityHeaders } from './plugins/security.js';
import { HttpError } from './plugins/errors.js';
import { registerHealth } from './routes/health.js';
import { registerWhoami } from './routes/whoami.js';
import { registerEnvContext } from './routes/envContext.js';
import { registerGrants } from './routes/grants.js';
import { registerAudit } from './routes/audit.js';
import { registerSecrets } from './routes/secrets.js';
import { registerRules } from './routes/rules.js';
import { registerPromote } from './routes/promote.js';
import type { EnginePublisher } from './grpc/publish.js';
import { LOG_FORMATTERS, LOG_REDACT } from './log/redact.js';

export interface AppDeps {
  sql: postgres.Sql;
  validator: JwtValidator;
  /** Undefined when KMS_URL is unset — secrets routes then 503. */
  cipher?: FieldCipher;
  /** `zara_app_dev` pool — unset → rule mutations 503. */
  rulesSql?: postgres.Sql;
  /** `zara_promote` pool — unset → rule reads/promotes 503. */
  promoteSql?: postgres.Sql;
  /** EngineControl gRPC client (ADR-0004) — unset → promote reports
   *  published:false and the engine poller converges. */
  enginePublisher?: EnginePublisher;
}

export async function buildApp(cfg: Config, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1024 * 1024, // JDM graphs arrive at Z4 — 1 MB ceiling.
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // ADR-0005: credential-shaped values can never reach a log line —
      // denylist walker over every log object + pino path censor for
      // transport carriers. Both layers are versioned in code.
      redact: LOG_REDACT,
      formatters: LOG_FORMATTERS,
    },
    trustProxy: cfg.rateLimitTrustXff,
  });
  app.setErrorHandler((e: unknown, _req, reply) => {
    if (e instanceof HttpError) {
      const extra = 'retryAfter' in e ? { retryAfter: e.retryAfter as number } : {};
      return reply.code(e.statusCode).send({ error: e.message, ...extra });
    }
    const sc =
      typeof e === 'object' && e !== null && 'statusCode' in e
        ? (e as { statusCode?: number }).statusCode
        : undefined;
    if (typeof sc === 'number' && sc < 500) {
      const msg = e instanceof Error ? e.message : 'request failed';
      return reply.code(sc).send({ error: msg });
    }
    app.log.error({ err: e }, 'internal error');
    return reply.code(500).send({ error: 'internal error' });
  });

  await registerRateLimits(app, cfg);
  registerSecurityHeaders(app);
  registerAuthGate(app, deps);

  registerHealth(app, deps.sql);
  registerWhoami(app);
  registerEnvContext(app);
  registerGrants(app, deps.sql);
  registerAudit(app, deps.sql);
  registerSecrets(app, deps.sql, deps.cipher);
  registerRules(app, deps.rulesSql, deps.promoteSql, deps.sql);
  registerPromote(app, deps.promoteSql, deps.sql, deps.enginePublisher);
  return app;
}
