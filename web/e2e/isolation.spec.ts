import { expect, test } from '@playwright/test';

/** Two-tenant isolation on shared infrastructure (MPE-178, ADR-0002).
 *  Runs in the northstar-engineer project: ns-engineer@zara.dev holds
 *  tenant_rule_engineer on Northstar only (seed/004). The spec creates
 *  and modifies a Northstar draft through the UI/BFF, then opens a
 *  second browser context as the Acme engineer to prove neither tenant
 *  can see the other's rows — RLS does the hiding, the UI just renders
 *  what the claims-scoped API returns. */

const NS_KEY = `e2e.ns-iso.${Date.now().toString(36)}`;
// Published only on Acme (seed/005) — must never appear in Northstar's list.
const ACME_ONLY_KEYS = ['underwriting', 'appraisal', 'discount-points', 'escrow-deposit'];

test('northstar engineer works its own matrix; acme rows invisible (and vice versa)', async ({
  page,
  request,
  browser,
}) => {
  // --- Northstar view: own published matrix, zero Acme artifacts -------
  await page.goto('/dev/rules');
  await expect(page.getByRole('row').filter({ hasText: 'origination' }).first()).toBeVisible();
  for (const k of ACME_ONLY_KEYS) {
    await expect(page.getByRole('row').filter({ hasText: k })).toHaveCount(0);
  }

  // --- Create a Northstar draft through the UI --------------------------
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByRole('textbox', { name: 'Key' }).fill(NS_KEY);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(`/dev/rules/${NS_KEY}`, { timeout: 15_000 });
  await expect(page.getByText('write access · working copy')).toBeVisible();

  // --- Modify it (same /bff contract the editor's save calls) -----------
  const specV1 = {
    nodes: [
      { id: 'i', type: 'inputNode', name: 'In', position: { x: 0, y: 0 } },
      { id: 'o', type: 'outputNode', name: 'Out', position: { x: 400, y: 0 } },
    ],
    edges: [{ id: 'e', sourceId: 'i', targetId: 'o' }],
  };
  const specV2 = { ...specV1, nodes: [...specV1.nodes, { id: 'x', type: 'decisionTableNode', name: 'Extra', position: { x: 200, y: 120 }, content: {} }] };
  const put = await request.put(`/bff/api/envs/dev/rules/${NS_KEY}`, {
    headers: { 'content-type': 'application/json' },
    data: { spec: specV2 },
  });
  expect(put.ok()).toBeTruthy();
  const got = await request.get(`/bff/api/envs/dev/rules/${NS_KEY}`);
  expect(got.ok()).toBeTruthy();
  const { rule } = (await got.json()) as { rule: { jdm: { nodes: unknown[] } } };
  expect(rule.jdm.nodes).toHaveLength(3);

  // Draft is listed on Northstar's dev rules.
  await page.goto('/dev/rules');
  await expect(page.getByRole('row').filter({ hasText: NS_KEY })).toBeVisible();

  // --- Vice versa: the Acme engineer cannot see any of it ---------------
  const acmeCtx = await browser.newContext({ storageState: 'e2e/.auth/engineer.json' });
  const acmePage = await acmeCtx.newPage();
  try {
    await acmePage.goto('/dev/rules');
    // Acme's own matrix is intact…
    await expect(acmePage.getByRole('row').filter({ hasText: 'underwriting' })).toBeVisible();
    // …and Northstar's draft + published rows are invisible.
    await expect(acmePage.getByRole('row').filter({ hasText: NS_KEY })).toHaveCount(0);
    const acmeApi = await acmeCtx.request.get('/bff/api/envs/dev/rules');
    const { rules } = (await acmeApi.json()) as { rules: { key: string }[] };
    expect(rules.some((r) => r.key === NS_KEY)).toBe(false);
  } finally {
    await acmeCtx.close();
  }
});
