import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';

export function registerHealth(app: FastifyInstance, sql: postgres.Sql): void {
  app.get('/healthz', async () => {
    await sql`SELECT 1`;
    return { status: 'ok', db: 'up' };
  });
}
