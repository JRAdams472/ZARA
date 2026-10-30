import type { FastifyInstance } from 'fastify';
import { accessIn, ENVS } from '../auth/roles.js';

/** Resolved caller context — claims, roles, and the env capability
 *  matrix (what this principal may do where). */
export function registerWhoami(app: FastifyInstance): void {
  app.get('/api/whoami', (req) => {
    const p = req.principal;
    return {
      sub: p.sub,
      tenantId: p.tenantId,
      permittedEnvs: p.permittedEnvs,
      roles: p.roles,
      envAccess: Object.fromEntries(ENVS.map((e) => [e, accessIn(p.roles, e)])),
      effectiveEnvs: p.effectiveEnvs,
    };
  });
}
