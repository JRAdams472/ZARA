//! Per-IP rate limits (@fastify/rate-limit): global bucket on every
//! request, tighter mutation bucket on PUT/DELETE. XFF honored only when
//! RATE_LIMIT_TRUST_XFF is set — otherwise the header is attacker-
//! controlled and would let anyone reset their own bucket.

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';

const MUTATION_METHODS = new Set(['PUT', 'DELETE', 'PATCH', 'POST']);

export async function registerRateLimits(app: FastifyInstance, cfg: Config): Promise<void> {
  if (cfg.rateLimitDisable) {
    app.log.warn('RATE_LIMIT_DISABLE set — per-IP limits off');
    return;
  }
  const opts = {
    max: cfg.rateLimitPerMin,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) =>
      cfg.rateLimitTrustXff
        ? ((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
          req.ip)
        : req.ip,
  };
  await app.register(rateLimit, {
    ...opts,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'rate limited',
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
  });
  // Tighter cap on mutations via a second instance scoped by route config.
  app.addHook('onRoute', (route) => {
    if (route.method && MUTATION_METHODS.has(String(route.method))) {
      route.config = {
        ...route.config,
        rateLimit: { max: cfg.rateLimitMutationsPerMin, timeWindow: '1 minute' },
      };
    }
  });
}
