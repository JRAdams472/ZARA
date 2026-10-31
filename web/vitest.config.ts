import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      SESSION_SECRET: 'vitest-session-secret-do-not-use-in-prod',
      API_URL: 'http://mgmt.test',
      OIDC_CLIENT_ID: 'zara-web',
      OIDC_AUTHORIZE_URL: 'http://dex.test/auth',
      OIDC_TOKEN_URL: 'http://dex.test/token',
      OIDC_REDIRECT_URI: 'http://localhost:3400/auth/callback',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/app/**/route.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
});
