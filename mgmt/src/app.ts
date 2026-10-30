import Fastify, { type FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import type { Config } from './config.js';
import type { JwtValidator } from './auth/jwks.js';
import { registerAuthGate } from './plugins/auth.js';
import { registerRateLimits } from './plugins/rateLimit.js';
import { registerSecurityHeaders } from './plugins/security.js';
import { HttpError } from './plugins/errors.js';
import { registerHealth } from './routes/health.js';
import { registerWhoami } from './routes/whoami.js';
import { registerEnvContext } from './routes/envContext.js';
import { registerGrants } from './routes/grants.js';
import { registerAudit } from './routes/audit.js';

export interface AppDeps {
  sql: postgres.Sql;
  validator: JwtValidator;
}

export async function buildApp(cfg: Config, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1024 * 1024, // JDM graphs arrive at Z4 — 1 MB ceiling.
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
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
  return app;
}
