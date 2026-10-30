//! Baseline response hardening on every response (same header set as the
//! engine): JSON-only surface → deny-all CSP + frame kill.

import type { FastifyInstance } from 'fastify';

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply) => {
    reply.headers({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
  });
}
