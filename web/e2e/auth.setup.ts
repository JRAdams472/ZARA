import { expect, test as setup, type Page } from '@playwright/test';

/** One real Dex login per persona; specs reuse the sealed session
 *  cookie via storageState instead of re-logging every test. Personas
 *  map to seeded dex users + role_grants (seed/003_demo_grants.sql). */
const PERSONAS = [
  { name: 'engineer', email: 'engineer@zara.dev', password: 'engineer123' },
  { name: 'auditor', email: 'auditor@zara.dev', password: 'auditor123' },
  { name: 'rm', email: 'admin@zara.dev', password: 'admin123' },
  { name: 'ns-engineer', email: 'ns-engineer@zara.dev', password: 'ns-engineer123' },
] as const;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with SSO' }).click();
  await expect(page).toHaveURL(/dex\/auth/, { timeout: 15_000 });
  await page.fill('input[name="login"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/localhost:3400/, { timeout: 20_000 });
  // App shell renders once whoami resolves — env chips visible.
  await expect(page.getByText('environment')).toBeVisible({ timeout: 20_000 });
}

for (const p of PERSONAS) {
  setup(`authenticate as ${p.name}`, async ({ page }) => {
    await login(page, p.email, p.password);
    await page.context().storageState({ path: `e2e/.auth/${p.name}.json` });
  });
}
