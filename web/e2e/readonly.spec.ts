import { expect, test } from '@playwright/test';

/** Auditor: QA/UAT read-only, DEV/PROD locked, zero mutation
 *  affordances anywhere — including a forced /dev URL. */
test('auditor is read-only everywhere; /dev redirects to /qa', async ({ page }) => {
  await page.goto('/dev/rules');
  await expect(page).toHaveURL(/\/qa\/rules/);

  // Shell state: role chip + env access.
  await expect(page.getByText('Auditor', { exact: true })).toBeVisible();
  await expect(page.getByText('Access: read')).toBeVisible();

  // List: no New rule, no promote buttons on published rows.
  await expect(page.getByRole('button', { name: 'New rule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Promote to/ })).toHaveCount(0);

  // Detail: immutable published artifact, no edit affordances at all.
  await page.goto('/qa/rules/origination');
  await expect(page.getByText('Published artifacts are immutable')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|Publish|Delete|New draft|Promote/ })).toHaveCount(0);

  // No admin nav for auditors.
  await expect(page.getByRole('link', { name: 'Role grants' })).toHaveCount(0);
});
