---
name: wiki-screenshots
description: Capture real web-UI screenshots for the GitHub wiki — run the isolated zarashots e2e stack, seed demo data, and shoot pages with Playwright. Use when a feature adds/changes user-facing screens or the wiki needs visual updates.
---

# Wiki screenshots

Tooling lives in `tools/wiki-shots/` (built in MPE-177): a dedicated
`docker-compose.zarashots.yml` stack, `dex.config.yaml`, `capture.mjs`,
and the runbook at `docs/wiki-screenshots.md`.

## Rules

- Always use the `zarashots` project (`docker compose -f
  tools/wiki-shots/docker-compose.zarashots.yml -p zarashots up -d`) —
  never shoot against the dev DB. Its port block is 5632/5756/8501/3500
  so it coexists with the dev stack.
- The stack seeds via the repo `seed/` files on first boot (idempotent;
  `-v` on down to reseed fresh).
- `networkidle` never settles on pages with live queries — `capture.mjs`
  waits on the rendered `waitFor` string per page instead.
- Inspect every PNG for loading spinners before publishing to the
  `Zara.wiki` repo (`images/` + `![alt](images/x.png)`, push to `master`).
- Screenshots must never contain real or realistic PII — the seeded
  fixtures (`acme-mortgage`, `northstar-lending`, `*@zara.dev`) are the
  only acceptable content.

## Quick path

```bash
docker compose -f tools/wiki-shots/docker-compose.zarashots.yml -p zarashots up -d
cd tools/wiki-shots && npm i && npx playwright install chromium
node capture.mjs          # → images/*.png, fails on spinner residue
```

Full procedure + teardown: `docs/wiki-screenshots.md`.
