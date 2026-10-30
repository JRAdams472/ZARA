#!/usr/bin/env bash
# t06 — FORCE ROW LEVEL SECURITY applies to the table owner: zara_migrate
# (object owner, non-superuser) sees zero rows without the tenant GUC.
source "$(dirname "$0")/lib.sh"

echo "t06: FORCE RLS applies to the owner"

n=$(psql_as zara_migrate ZARA_MIGRATE_PASSWORD \
    -c "SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $n == "0" ]] || { echo "FAIL: owner saw $n rows without GUC (expected 0)" >&2; exit 1; }

# And with a GUC it sees only that tenant's rows — same boundary, same proof.
n=$(psql_as zara_migrate ZARA_MIGRATE_PASSWORD \
    -c "SET zara.tenant_id='$TENANT_A'; SELECT count(*) FROM zara_dev.rule_artifacts;" | scalar)
[[ $n == "1" ]] || { echo "FAIL: owner saw $n rows under tenant A (expected 1)" >&2; exit 1; }

echo "t06 OK"
