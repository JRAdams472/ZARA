#!/usr/bin/env bash
# t03 — with no tenant GUC the RLS policy NULL-compares: zero rows, never an error-by-default leak.
source "$(dirname "$0")/lib.sh"

echo "t03: unset zara.tenant_id denies all rows"

n=$(psql_as zara_app_dev ZARA_APP_DEV_PASSWORD \
    -c "SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $n == "0" ]] || { echo "FAIL: expected 0 rows without GUC, got '$n'" >&2; exit 1; }

echo "t03 OK"
