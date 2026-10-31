import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Next's tsconfig sets jsx:preserve — vitest must transform JSX itself
  // (vite 8 transforms via oxc, not esbuild).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
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
      '@gorules/jdm-editor/dist/style.css': fileURLToPath(
        new URL('./test/stubs/empty.ts', import.meta.url),
      ),
    },
  },
});
