import { expect, test, type Page } from '@playwright/test';

/** MVP lifecycle proof (MPE-178): one JDM graph travels the full
 *  DEV → QA → UAT → PROD promotion chain through the UI as the Release
 *  Manager. Every hop asserts the immutable sha256 is identical — the
 *  graph is copied verbatim, never mutated — plus the published flag
 *  and the append-only promotion-history rows. */

const KEY = `e2e.lifecycle.${Date.now().toString(36)}`;
const SHA_RE = /sha256\s+([0-9a-f]{64})/;

async function snackbarSha(page: Page): Promise<string> {
  const el = page.getByText(SHA_RE).first();
  await expect(el).toBeVisible({ timeout: 15_000 });
  const m = SHA_RE.exec(await el.textContent());
  expect(m, 'snackbar must carry the full sha256').toBeTruthy();
  return m![1]!;
}

async function promoteRow(page: Page, envPath: string, toEnv: string) {
  await page.goto(`/${envPath}/rules`);
  const row = page
    .getByRole('row')
    .filter({ hasText: 'published' })
    .filter({ hasText: KEY });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: `Promote to ${toEnv}` }).click();
  // Confirm dialog shows the same sha being copied.
  await expect(page.getByRole('dialog')).toContainText(KEY);
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  return snackbarSha(page);
}

test('RM drives one graph draft → publish → DEV → QA → UAT → PROD', async ({ page }) => {
  // Draft via UI.
  await page.goto('/dev/rules');
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByRole('textbox', { name: 'Key' }).fill(KEY);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(`/dev/rules/${KEY}`, { timeout: 15_000 });

  // Publish — capture the immutable graph hash.
  await page.getByRole('button', { name: 'Publish' }).click();
  const publishSha = await snackbarSha(page);

  // DEV → QA.
  const qaSha = await promoteRow(page, 'dev', 'QA');
  expect(qaSha).toBe(publishSha);

  // QA → UAT.
  const uatSha = await promoteRow(page, 'qa', 'UAT');
  expect(uatSha).toBe(publishSha);

  // UAT → PROD — RM-only sign-off, present for this persona.
  const prodSha = await promoteRow(page, 'uat', 'PROD');
  expect(prodSha).toBe(publishSha);

  // PROD holds the published copy.
  await page.goto('/prod/rules');
  await expect(
    page.getByRole('row').filter({ hasText: 'published' }).filter({ hasText: KEY }),
  ).toBeVisible({ timeout: 15_000 });

  // Append-only history: the PROD promotions page records the sign-off
  // with the same graph hash.
  await page.goto('/prod/promotions');
  const histRow = page.getByRole('row').filter({ hasText: KEY });
  await expect(histRow).toBeVisible({ timeout: 15_000 });
  await expect(histRow).toContainText(publishSha.slice(0, 12));
});
