import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests hit a real Postgres/OpenBao — generous timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
