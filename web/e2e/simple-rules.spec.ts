import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from '@playwright/test';

/** Simple (business) rule-editing mode (MPE-194): a rule whose graph is
 *  exactly one decisionTableNode gets a table-only editor; the Simple |
 *  Advanced toggle swaps views, table edits patch back into the same
 *  draft save path, and the rest of the graph is preserved byte-for-byte.
 *  Drafts are seeded through the BFF and cleaned up so reruns stay
 *  order-independent. */

const KEY = 'e2e.simple';
const MULTI_KEY = 'e2e.simple.multi';

const TABLE = {
  hitPolicy: 'first',
  inputs: [{ id: 'i1', name: 'Loan purpose', field: 'loan.purpose' }],
  outputs: [
    { id: 'o1', name: 'charged', field: 'charged' },
    { id: 'o2', name: 'amount', field: 'amount' },
  ],
  rules: [{ _id: 'r1', i1: "'purchase'", o1: 'true', o2: '795' }],
};

const node = (id: string, type: string, x: number, content?: unknown) => ({
  id,
  type,
  name: id,
  position: { x, y: 0 },
  ...(content ? { content } : {}),
});

const JDM = {
  nodes: [
    node('in', 'inputNode', 0),
    node('tbl', 'decisionTableNode', 200, TABLE),
    node('out', 'outputNode', 400),
  ],
  edges: [
    { id: 'e1', sourceId: 'in', targetId: 'tbl' },
    { id: 'e2', sourceId: 'tbl', targetId: 'out' },
  ],
};

const MULTI_JDM = {
  nodes: [
    node('in', 'inputNode', 0),
    node('tbl0', 'decisionTableNode', 200, TABLE),
    node('tbl1', 'decisionTableNode', 400, TABLE),
    node('out', 'outputNode', 600),
  ],
  edges: [
    { id: 'e1', sourceId: 'in', targetId: 'tbl0' },
    { id: 'e2', sourceId: 'tbl0', targetId: 'out' },
  ],
};

async function api(
  ctx: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  body?: unknown,
) {
  // Every e2e request shares the API's per-IP edge quota; a 429 under
  // parallel workers is contention, not a failure — retry briefly.
  for (let attempt = 0; ; attempt++) {
    const res = await ctx[method](`/bff${path}`, { data: body });
    if (res.status() !== 429 || attempt === 2) return res;
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/** Engineer-persona browser context — one context supplies both the BFF
 *  API requester (for seeding/cleanup) and the page under test. */
function engineerCtx(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: 'e2e/.auth/engineer.json' });
}

async function seedDraft(ctx: APIRequestContext, key: string, spec: unknown) {
  // DELETE-first so reruns reset state even after an interrupted run.
  await api(ctx, 'delete', `/api/envs/dev/rules/${encodeURIComponent(key)}`);
  const res = await api(ctx, 'post', '/api/envs/dev/rules', {
    key,
    kind: 'base_fee',
    spec,
  });
  expect(res.ok()).toBe(true);
}

test('simple mode: table view, advanced toggle, save preserves graph', async ({
  browser,
}) => {
  const ctx = await engineerCtx(browser);
  const page = await ctx.newPage();
  try {
    await seedDraft(ctx.request, KEY, JDM);

    await page.goto(`/dev/rules/${KEY}`);

    // Simple is the default view — the standalone decision table renders
    // the column names from the seed.
    await expect(page.getByRole('button', { name: 'Simple' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.grl-dt')).toBeVisible();
    await expect(page.locator('.grl-dt')).toContainText('Loan purpose');
    await expect(page.locator('.grl-dt')).toContainText('charged');
    // The seeded row renders in the table — business mode dequotes the
    // string literal, so the cell shows `purchase`/`795` either way.
    await expect(page.locator('.grl-dt')).toContainText('purchase', { timeout: 15_000 });
    await expect(page.locator('.grl-dt')).toContainText('795');

    // Advanced shows the full node graph.
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.locator('.grl-dg')).toBeVisible();

    // Back to Simple — add a rule row via the table's "Add row" control,
    // which marks the draft dirty and enables Save.
    await page.getByRole('button', { name: 'Simple' }).click();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await page.getByRole('button', { name: 'Add row' }).click();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

    // The persisted draft gained exactly one rule; nodes/edges otherwise
    // identical to the seed.
    const got = await api(
      ctx.request,
      'get',
      `/api/envs/dev/rules/${encodeURIComponent(KEY)}`,
    );
    const body = (await got.json()) as {
      rule: {
        spec: {
          nodes: { id: string; content?: typeof TABLE }[];
          edges: unknown[];
        };
      };
    };
    const tbl = body.rule.spec.nodes.find((n) => n.id === 'tbl');
    expect(tbl?.content?.rules.length).toBe(TABLE.rules.length + 1);
    expect(body.rule.spec.nodes.map((n) => n.id)).toEqual(['in', 'tbl', 'out']);
    expect(body.rule.spec.edges).toEqual(JDM.edges);
  } finally {
    await api(ctx.request, 'delete', `/api/envs/dev/rules/${encodeURIComponent(KEY)}`);
    await page.close();
    await ctx.close();
  }
});

test('simple mode falls back with a notice when a rule is not single-table', async ({
  browser,
}) => {
  const ctx = await engineerCtx(browser);
  const page = await ctx.newPage();
  try {
    await seedDraft(ctx.request, MULTI_KEY, MULTI_JDM);

    await page.goto(`/dev/rules/${MULTI_KEY}`);

    // Multiple tables → defaults to Advanced; Simple shows the notice.
    await expect(page.locator('.grl-dg')).toBeVisible();
    await page.getByRole('button', { name: 'Simple' }).click();
    await expect(page.getByText(/multiple decision tables/)).toBeVisible();
    // The notice never blocks the advanced editor.
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.locator('.grl-dg')).toBeVisible();
  } finally {
    await api(ctx.request, 'delete', `/api/envs/dev/rules/${encodeURIComponent(MULTI_KEY)}`);
    await page.close();
    await ctx.close();
  }
});
