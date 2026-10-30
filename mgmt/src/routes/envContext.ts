import type { FastifyInstance } from 'fastify';
import { accessIn, parseEnv } from '../auth/roles.js';
import { notFound } from '../plugins/errors.js';

/** Env-gated capability probe — the gate's env authorization surface.
 *  403 if env ∉ claims ∩ role scope (checked by the gate hook first). */
export function registerEnvContext(app: FastifyInstance): void {
  app.get('/api/envs/:env/context', (req) => {
    const { env } = req.params as { env: string };
    const parsed = parseEnv(env);
    if (!parsed) throw notFound('unknown environment');
    return {
      env: parsed,
      tenantId: req.principal.tenantId,
      access: accessIn(req.principal.roles, parsed),
    };
  });
}
