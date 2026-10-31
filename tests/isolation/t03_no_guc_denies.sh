#!/usr/bin/env bash
# t03 — with no tenant GUC the tenant_guc() guard RAISES: a tenant-scoped
# query without the GUC is a bug and must scream (MPE-166, fail-loud).
source "$(dirname "$0")/lib.sh"

echo "t03: unset zara.tenant_id raises the fail-loud error"

expect_fail zara_app_dev ZARA_APP_DEV_PASSWORD \
    "zara.tenant_id is not set" \
    -c "SELECT count(*) FROM zara_dev.rule_artifacts;"

echo "t03 OK"
