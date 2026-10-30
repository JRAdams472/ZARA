import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests hit a real Postgres/OpenBao — generous timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // Floor enforced per-area by scripts/covercheck.mjs (sibling
      // convention) — not by vitest's flat thresholds.
    },
  },
});
