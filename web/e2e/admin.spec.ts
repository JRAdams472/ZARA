import { expect, test } from '@playwright/test';

/** Release Manager: UAT→PROD sign-off + admin surfaces. Runs last — it
 *  mutates seeded state only for its own key/grant. */
const KEY = `e2e.rm.${Date.now().toString(36)}`;

test('RM sign-off UAT → PROD via UI', async ({ page, request }) => {
  // Seed a published artifact in UAT directly through the API: create
  // draft in dev, publish, promote to qa, promote to uat — all via /bff
  // with the RM session (exercises the same contract the UI calls).
  const spec = {
    nodes: [
      { id: 'i', type: 'inputNode', name: 'In', position: { x: 0, y: 0 } },
      { id: 'o', type: 'outputNode', name: 'Out', position: { x: 400, y: 0 } },
    ],
    edges: [{ id: 'e', sourceId: 'i', targetId: 'o' }],
  };
  const post = (path: string, body?: unknown) =>
    request.post(`/bff${path}`, {
      headers: body ? { 'content-type': 'application/json' } : undefined,
      ...(body ? { data: body } : {}),
    });
  let res = await post('/api/envs/dev/rules', { key: KEY, kind: 'base_fee', spec });
  expect(res.status()).toBe(201);
  res = await post(`/api/envs/dev/rules/${KEY}/publish`);
  expect(res.ok()).toBeTruthy();
  res = await post(`/api/envs/dev/rules/${KEY}/promote`);
  expect(res.ok()).toBeTruthy();
  res = await post(`/api/envs/qa/rules/${KEY}/promote`);
  expect(res.ok()).toBeTruthy();

  // UAT detail → PROD sign-off button visible for RM only.
  await page.goto('/uat/rules');
  const row = page.getByRole('row').filter({ hasText: KEY });
  await row.getByRole('button', { name: 'Promote to PROD' }).click();
  await page.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(page.getByText(/Promoted UAT → PROD — sha256/)).toBeVisible({ timeout: 15_000 });

  // PROD history records the sign-off.
  await page.goto('/prod/promotions');
  await expect(page.getByRole('row').filter({ hasText: KEY })).toBeVisible();
});

test('RM admin: grants list/create/revoke + audit chain verify', async ({ page }) => {
  await page.goto('/admin/grants');
  await expect(page.getByRole('heading', { name: 'Role grants' })).toBeVisible();
  await expect(page.getByText('engineer@zara.dev')).toBeVisible();

  // Create a grant.
  await page.getByRole('button', { name: 'New grant' }).click();
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(`e2e-subject-${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Grant', exact: true }).click();
  await expect(page.getByText('e2e-subject-').first()).toBeVisible();

  // Revoke it right back.
  const newRow = page.getByRole('row').filter({ hasText: 'e2e-subject-' });
  await newRow.getByRole('button', { name: /revoke/ }).click();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('e2e-subject-')).toHaveCount(0);

  // Audit tail renders + chain verifies.
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  await expect(page.getByText(/Chain verified — \d+ events/)).toBeVisible();
  await expect(page.getByText('grant.put').first()).toBeVisible();
});
