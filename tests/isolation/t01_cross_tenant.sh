#!/usr/bin/env bash
# t01 — RLS confines rows to the caller's tenant GUC.
source "$(dirname "$0")/lib.sh"

echo "t01: cross-tenant isolation"

a=$(psql_as zara_app_dev ZARA_APP_DEV_PASSWORD \
    -c "SET zara.tenant_id='$TENANT_A'; SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $a == "1" ]] || { echo "FAIL: tenant A expected 1 artifact, got '$a'" >&2; exit 1; }

b=$(psql_as zara_app_dev ZARA_APP_DEV_PASSWORD \
    -c "SET zara.tenant_id='$TENANT_B'; SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $b == "1" ]] || { echo "FAIL: tenant B expected 1 artifact, got '$b'" >&2; exit 1; }

# Write under a different tenant than the GUC → RLS WITH CHECK violation.
expect_fail zara_app_dev ZARA_APP_DEV_PASSWORD "row-level security" \
    -c "SET zara.tenant_id='$TENANT_A';
        INSERT INTO zara_dev.rule_artifacts (tenant_id,key,kind,spec,jdm,created_by)
        VALUES ('$TENANT_B','smuggle','base_fee','{}','{}','t01');"

echo "t01 OK"
