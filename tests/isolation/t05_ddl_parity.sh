#!/usr/bin/env bash
# t05 — all four env schemas carry identical DDL: schema-only dumps differ
# only in the schema name, and the _sqlx_migrations ledgers match.
source "$(dirname "$0")/lib.sh"

echo "t05: env-schema DDL parity"

dump_schema() {
    # Normalize the schema name AND the per-env app role (each env schema
    # legitimately grants to its own zara_app_<env> — that's topology, not
    # drift). Everything else must be byte-identical.
    pg_dump "$(admin_dsn)" --schema-only --schema="$1" \
        | sed -e "s/$1/SCHEMA/g" -e 's/zara_app_[a-z]*/APP_ROLE/g' \
        | grep -vE '^(\\|--|$)' | sort
}

base=$(dump_schema zara_dev)
for schema in zara_qa zara_uat zara_prod; do
    if ! diff <(echo "$base") <(dump_schema "$schema") >/dev/null; then
        echo "FAIL: schema drift between zara_dev and $schema:" >&2
        diff <(echo "$base") <(dump_schema "$schema") >&2
        exit 1
    fi
    echo "  zara_dev == $schema"
done

# Migration ledgers must also be identical (uniform application proof).
for schema in zara_qa zara_uat zara_prod; do
    diff \
        <(psql_admin -c "SELECT version, checksum FROM zara_dev._sqlx_migrations ORDER BY version;") \
        <(psql_admin -c "SELECT version, checksum FROM ${schema}._sqlx_migrations ORDER BY version;") \
        >/dev/null \
        || { echo "FAIL: _sqlx_migrations drift between zara_dev and $schema" >&2; exit 1; }
done
echo "  ledgers identical across all four schemas"

echo "t05 OK"
