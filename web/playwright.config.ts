import { defineConfig } from '@playwright/test';

// e2e runs against the seeded compose stack — Postgres + dex + mgmt +
// web (container or `next start`). The webServer block starts the prod
// server when nothing is already listening on :3400.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3400',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'engineer',
      dependencies: ['setup'],
      testMatch: /promote\.spec\.ts/,
      use: { storageState: 'e2e/.auth/engineer.json' },
    },
    {
      name: 'auditor',
      dependencies: ['setup'],
      testMatch: /readonly\.spec\.ts/,
      use: { storageState: 'e2e/.auth/auditor.json' },
    },
    {
      name: 'release-manager',
      dependencies: ['setup'],
      testMatch: /admin\.spec\.ts/,
      use: { storageState: 'e2e/.auth/rm.json' },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3400',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
