# Wiki screenshots — zarashots stack

How to capture fresh console screenshots for the GitHub wiki (`Zara.wiki.git`)
using the isolated `zarashots` compose project. **Never shoot against the
dev DB** — the stack below has its own Postgres, dex, mgmt, and web on a
separate port block (5632 / 5756 / 8501 / 3500), seeded from the same
`synthetic` demo fixtures.

## Bring the stack up

```bash
# .devkeys must exist (JWKS + dev.pem used by web's token exchange +
# mgmt's validator). Generate once if missing:
cargo run -p zara-engine --bin zara_devtoken -- \
    --jwks-out .devkeys/jwks.json --key-out .devkeys/dev.pem \
    --tenant-id aa5ce000-0000-4000-8000-0000000000ac --envs dev

docker compose -f tools/wiki-shots/docker-compose.zarashots.yml -p zarashots up -d
# wait for zara-migrate + zara-seed one-shots: compose ps shows them Exited (0)
```

The stack exposes: web `http://localhost:3500`, dex `http://localhost:5756`,
mgmt `http://localhost:8501`, postgres `localhost:5632`. Engine/openbao/
observability are intentionally omitted — nothing in the shot set needs
them (KMS unset → the secrets API 503s, and there is no secrets page).

## Capture

```bash
cd tools/wiki-shots && npm i            # playwright — first run also: npx playwright install chromium
node capture.mjs                         # → images/*.png
```

`capture.mjs` logs in through the real dex PKCE flow (`admin@zara.dev` /
`admin123`), then shoots each page in `SHOTS` after the rendered text in
`waitFor` appears — `networkidle` is never trusted under live queries.
A shot that still shows a loading marker fails the run (exit 1) so no
spinner reaches the wiki.

To add a page: extend `SHOTS` with `{ name, path, waitFor }` — pick the
string that proves the page settled (a status chip, heading, or cell).

## Before publishing to the wiki

1. **Inspect every PNG** for loading spinners, skeletons, or stale state —
   `capture.mjs` fails fast on a marker it can see, but a visual pass is
   required before publishing.
2. **PII check** — the fixture is synthetic (`acme-mortgage` /
   `northstar-lending`, `*@zara.dev` users, `e2e.*`/`seed` artifacts).
   Never shoot a stack that has had real data loaded.
3. Copy the accepted PNGs into the wiki repo under `images/`, embed with
   `![alt](images/x.png)`, and push to `master` (see Plan Close-Out §8 in
   AGENTS.md).

## Teardown

```bash
docker compose -f tools/wiki-shots/docker-compose.zarashots.yml -p zarashots down -v
```

`-v` drops the `zarashots_pgdata` volume so the next capture starts from a
fresh seed — the reseed is idempotent and takes seconds.
