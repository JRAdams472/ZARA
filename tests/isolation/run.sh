#!/usr/bin/env bash
# Isolation suite entry point (MPE-141). Seeds two fixture tenants + one
# published artifact each via the admin role, then runs every tNN test.
# All fixture data is synthetic; cleanup is optional (dev DBs are disposable).
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh

export TENANT_A TENANT_B
TENANT_A=$(psql_admin -c "INSERT INTO zara_control.tenants (slug,name)
    VALUES ('iso-alpha','Isolation Alpha')
    ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
    RETURNING id;")
TENANT_B=$(psql_admin -c "INSERT INTO zara_control.tenants (slug,name)
    VALUES ('iso-bravo','Isolation Bravo')
    ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
    RETURNING id;")
echo "fixtures: TENANT_A=$TENANT_A TENANT_B=$TENANT_B"

# One published artifact per tenant in zara_dev — the admin (superuser)
# bypasses RLS for fixture setup; the tests prove nobody else can.
# Guarded by NOT EXISTS so re-runs are no-ops (published rows are
# immutable — there is no delete/upsert path, by design).
psql_admin -c "
    INSERT INTO zara_dev.rule_artifacts
        (tenant_id,key,kind,status,spec,jdm,sha256,created_by,published_at)
    SELECT '$TENANT_A','iso-base-fee','base_fee','published','{\"fee\":\"origination\"}','{}','a1','iso',now()
    WHERE NOT EXISTS (SELECT 1 FROM zara_dev.rule_artifacts
                      WHERE tenant_id='$TENANT_A' AND key='iso-base-fee' AND status='published');
    INSERT INTO zara_dev.rule_artifacts
        (tenant_id,key,kind,status,spec,jdm,sha256,created_by,published_at)
    SELECT '$TENANT_B','iso-base-fee','base_fee','published','{\"fee\":\"origination\"}','{}','b1','iso',now()
    WHERE NOT EXISTS (SELECT 1 FROM zara_dev.rule_artifacts
                      WHERE tenant_id='$TENANT_B' AND key='iso-base-fee' AND status='published');
"

fail=0
for t in t0*.sh; do
    echo "=== $t ==="
    bash "$t" || fail=1
done

if [[ $fail -eq 0 ]]; then
    echo "ALL ISOLATION TESTS PASSED"
else
    echo "ISOLATION SUITE FAILED" >&2
fi
exit $fail
