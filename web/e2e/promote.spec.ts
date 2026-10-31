import { expect, test } from '@playwright/test';

/** Engineer flow: draft → publish → promote dev→qa → promote qa→uat.
 *  The UAT→PROD affordance must NOT render for engineer (RM-only). */
const KEY = `e2e.promote.${Date.now().toString(36)}`;

test('engineer promotes published rule DEV → QA → UAT; PROD gate hidden', async ({ page }) => {
  // Create a draft via the UI.
  await page.goto('/dev/rules');
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByRole('textbox', { name: 'Key' }).fill(KEY);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(`/dev/rules/${KEY}`, { timeout: 15_000 });

  // Publish → sha256 snackbar.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published — sha256 [0-9a-f]{64}/)).toBeVisible({ timeout: 15_000 });

  // Detail prefers the draft working copy — promote from the list row.
  await page.goto('/dev/rules');
  const devRow = page.getByRole('row').filter({ hasText: 'published' }).filter({ hasText: KEY });
  await devRow.getByRole('button', { name: 'Promote to QA' }).click();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.getByText(/Promoted DEV → QA — sha256/)).toBeVisible({ timeout: 15_000 });

  // QA shows the published copy; promote it onward to UAT.
  await page.goto('/qa/rules');
  const qaRow = page.getByRole('row').filter({ hasText: KEY });
  await expect(qaRow).toBeVisible();
  await qaRow.getByRole('button', { name: 'Promote to UAT' }).click();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.getByText(/Promoted QA → UAT — sha256/)).toBeVisible({ timeout: 15_000 });

  // UAT: artifact present, but engineer gets NO promote affordance (RM-only PROD).
  await page.goto('/uat/rules');
  const uatRow = page.getByRole('row').filter({ hasText: KEY });
  await expect(uatRow).toBeVisible();
  await expect(uatRow.getByRole('button', { name: 'Promote to PROD' })).toHaveCount(0);

  // Promotion history in QA records the DEV→QA move.
  await page.goto('/qa/promotions');
  await expect(page.getByRole('row').filter({ hasText: KEY })).toBeVisible();
});
