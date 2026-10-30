#!/usr/bin/env bash
# t07 — seeded demo artifacts are visible only under the owning tenant's
# GUC. Self-skips on unseeded databases so the suite still runs pre-seed;
# CI seeds before the suite so the assertions run for real there.
source "$(dirname "$0")/lib.sh"

echo "t07: seeded tenant visibility"

seeded=$(psql_admin -c "SELECT count(*) FROM zara_control.tenants
    WHERE slug IN ('acme-mortgage','northstar-lending');")
if [[ "$seeded" != "2" ]]; then
    echo "t07 SKIP (no seed data — apply seed/001+002 first)"
    exit 0
fi

ACME=$(psql_admin -c "SELECT id FROM zara_control.tenants WHERE slug='acme-mortgage';")
NORTH=$(psql_admin -c "SELECT id FROM zara_control.tenants WHERE slug='northstar-lending';")

# Expected artifact counts per tenant: dev holds 2 published + 2 drafts;
# qa/uat/prod hold the 2 published rows only.
declare -A EXPECT=( [zara_dev]=4 [zara_qa]=2 [zara_uat]=2 [zara_prod]=2 )
declare -A PW=( [zara_dev]=ZARA_APP_DEV_PASSWORD [zara_qa]=ZARA_APP_QA_PASSWORD
                [zara_uat]=ZARA_APP_UAT_PASSWORD [zara_prod]=ZARA_APP_PROD_PASSWORD )
declare -A ROLE=( [zara_dev]=zara_app_dev [zara_qa]=zara_app_qa
                  [zara_uat]=zara_app_uat [zara_prod]=zara_app_prod )

for schema in zara_dev zara_qa zara_uat zara_prod; do
    for tenant in "$ACME" "$NORTH"; do
        n=$(psql_as "${ROLE[$schema]}" "${PW[$schema]}" \
            -c "SET zara.tenant_id='$tenant';
                SELECT count(*) FROM ${schema}.rule_artifacts;" | scalar)
        [[ $n == "${EXPECT[$schema]}" ]] || {
            echo "FAIL: $schema expected ${EXPECT[$schema]} rows under GUC $tenant, got '$n'" >&2
            exit 1; }
    done
    # Under acme's GUC, zero of northstar's rows are reachable — and vice versa.
    leak=$(psql_as "${ROLE[$schema]}" "${PW[$schema]}" \
        -c "SET zara.tenant_id='$ACME';
            SELECT count(*) FROM ${schema}.rule_artifacts WHERE tenant_id='$NORTH';" | scalar)
    [[ $leak == "0" ]] || { echo "FAIL: $schema leaked $leak cross-tenant rows" >&2; exit 1; }
    echo "  $schema: per-tenant counts ${EXPECT[$schema]}, cross-tenant 0"
done

# Drafts exist only in dev, under the owning tenant.
d=$(psql_as zara_app_dev ZARA_APP_DEV_PASSWORD \
    -c "SET zara.tenant_id='$ACME';
        SELECT count(*) FROM zara_dev.rule_artifacts WHERE status='draft';" | scalar)
[[ $d == "2" ]] || { echo "FAIL: expected 2 acme drafts in zara_dev, got '$d'" >&2; exit 1; }

q=$(psql_as zara_app_qa ZARA_APP_QA_PASSWORD \
    -c "SET zara.tenant_id='$ACME';
        SELECT count(*) FROM zara_qa.rule_artifacts WHERE status='draft';" | scalar)
[[ $q == "0" ]] || { echo "FAIL: expected 0 drafts outside dev, got '$q'" >&2; exit 1; }

# No GUC at all → seeded data is still unreachable.
none=$(psql_as zara_app_dev ZARA_APP_DEV_PASSWORD \
    -c "SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $none == "0" ]] || { echo "FAIL: no-GUC saw '$none' seeded rows" >&2; exit 1; }

echo "t07 OK"
