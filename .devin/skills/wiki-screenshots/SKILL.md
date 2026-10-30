---
name: wiki-screenshots
description: Capture real web-UI screenshots for the GitHub wiki — run the isolated zarashots e2e stack, seed demo data, and shoot pages with Playwright. Use when a feature adds/changes user-facing screens or the wiki needs visual updates.
---

# Wiki screenshots

The Zara wiki-screenshots runbook and tooling are created in milestone Z5
(Management UI) — `tools/wiki-shots/` does not exist yet. Until then this
skill documents the sibling conventions the Z5 tooling must follow
(inherited from LENA2/LOLA):

- Always use a separate compose project (`-p zarashots`) — never shoot
  against the dev DB.
- Seed demo data via a dedicated `--profile seed` service / idempotent
  seeder script (`tools/wiki-shots/seed_demo.*`) before capturing.
- `networkidle` never settles on pages with live queries — wait on
  rendered text instead.
- Inspect every PNG for loading spinners before publishing to the
  `Zara.wiki` repo (`images/` + `![alt](images/x.png)`, push to `master`).
- Screenshots must never contain real or realistic PII — synthetic
  tenants/scenarios only.
- When Z5 lands the runbook lives at `docs/wiki-screenshots.md` and the
  capture script at `tools/wiki-shots/capture.mjs`; update this skill
  then.
