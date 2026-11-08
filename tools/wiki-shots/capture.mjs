#!/usr/bin/env node
// wiki-shots capture (MPE-177) — drives the isolated zarashots stack and
// produces the images/ set for the GitHub wiki. Synthetic data only
// (seed/* fixtures); every shot waits on rendered text — `networkidle`
// never settles under live queries — and fails on a detected loading
// state so no spinner reaches the wiki.
//
//   node tools/wiki-shots/capture.mjs [--base http://localhost:3500] [--out images]
//
// Requires: zarashots stack up (docker compose -f ... -p zarashots up -d),
// .devkeys present, `npm i` in tools/wiki-shots.

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const BASE = flag('base', 'http://localhost:3500');
const DEX = BASE.includes('3500') ? 'http://localhost:5756' : 'http://localhost:5656';
const OUT = flag('out', join('images'));
const USER = flag('user', 'admin@zara.dev');
const PASS = flag('pass', 'admin123');

// Page → the rendered text that proves it settled (never networkidle).
// waitSelector (optional) waits on a DOM element for widgets whose text
// isn't reliable — e.g. the client-only GoRules editor renders the
// .grl-dt table only after hydration, while 'SHA-256' matches instantly.
const SHOTS = [
  { name: 'rules-dev', path: '/dev/rules', waitFor: 'published' },
  { name: 'rules-dev-detail', path: '/dev/rules/origination', waitFor: 'SHA-256', waitSelector: '.grl-dt' },
  { name: 'rules-qa', path: '/qa/rules', waitFor: 'published' },
  { name: 'promotions-prod', path: '/prod/promotions', waitFor: 'Graph SHA-256' },
  { name: 'admin-grants', path: '/admin/grants', waitFor: 'Role grants' },
  { name: 'admin-audit', path: '/admin/audit', waitFor: 'Audit trail' },
];

// Loading-state markers that must never appear in a published shot.
const SPINNER_RE = /loading|spinner|skeleton/i;

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole('link', { name: 'Sign in with SSO' }).click();
  await page.waitForURL(/dex\/auth/, { timeout: 15_000 });
  await page.fill('input[name="login"]', USER);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(BASE.replace('://', '://').replace('.', '\\.')), {
    timeout: 20_000,
  });
  await page.getByText('environment').first().waitFor({ timeout: 20_000 });
}

/** Fresh stacks have zero promotion history — drive one artifact through
 *  DEV→QA→UAT→PROD via the /bff contract so the promotions page has real
 *  rows. Idempotent-ish: a re-run just appends another history row. */
async function ensurePromotionHistory(ctx) {
  const KEY = 'wiki-shots.demo';
  const spec = {
    nodes: [
      { id: 'in', type: 'inputNode', name: 'Loan scenario', position: { x: 0, y: 0 } },
      { id: 'out', type: 'outputNode', name: 'Fees', position: { x: 480, y: 0 } },
    ],
    edges: [{ id: 'e1', sourceId: 'in', targetId: 'out' }],
  };
  const api = ctx.request;
  const post = (path, body) =>
    api.post(`${BASE}${path}`, {
      headers: body ? { 'content-type': 'application/json' } : undefined,
      ...(body ? { data: body } : {}),
    });
  const rulesRes = await api.get(`${BASE}/bff/api/envs/dev/rules`);
  const { rules } = await rulesRes.json();
  if (!rules.some((r) => r.key === KEY)) {
    const r = await post('/bff/api/envs/dev/rules', { key: KEY, kind: 'base_fee', spec });
    if (!r.ok()) throw new Error(`create ${KEY}: ${r.status()} ${await r.text()}`);
  }
  await post(`/bff/api/envs/dev/rules/${KEY}/publish`).catch(() => {});
  for (const env of ['dev', 'qa', 'uat']) {
    const r = await post(`/bff/api/envs/${env}/rules/${KEY}/promote`);
    if (!r.ok()) console.warn(`promote ${env}: ${r.status()} (continuing)`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  await ensurePromotionHistory(ctx);

  const failures = [];
  for (const s of SHOTS) {
    try {
      await page.goto(`${BASE}${s.path}`);
      await page.getByText(s.waitFor).first().waitFor({ timeout: 20_000 });
      if (s.waitSelector) {
        await page.waitForSelector(s.waitSelector, { timeout: 20_000 });
      }
      // No loading-state residue may be present when we shoot.
      const spinner = page.getByText(SPINNER_RE);
      if ((await spinner.count()) > 0) {
        failures.push(`${s.name}: loading state still visible (${s.waitFor})`);
      }
      const file = join(OUT, `${s.name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`shot ${s.name} → ${file}`);
    } catch (e) {
      failures.push(`${s.name}: ${e.message ?? e}`);
    }
  }
  await browser.close();

  if (failures.length) {
    console.error(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${SHOTS.length} clean shots in ${OUT}/ — inspect each PNG for PII before pushing to the wiki.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
