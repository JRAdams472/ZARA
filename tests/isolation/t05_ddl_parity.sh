#!/usr/bin/env bash
# t05 — all four env schemas carry identical DDL. Compares a normalized
# catalog signature per schema (columns, constraints, indexes, triggers,
# trigger functions, RLS flags, policies, table grants) rather than
# pg_dump — catalog queries are agnostic to client/server version drift.
source "$(dirname "$0")/lib.sh"

echo "t05: env-schema DDL parity"

signature() {
    # Normalize the schema name AND the per-env app role (each env schema
    # legitimately grants to its own zara_app_<env> — that's topology, not
    # drift). Everything else must be identical.
    psql_admin -v "schema=$1" -f - <<'SQL' | sed -e "s/$1/SCHEMA/g" -e 's/zara_app_[a-z]*/APP_ROLE/g' | sort
WITH s AS (SELECT :'schema'::regnamespace AS ns)
SELECT 'col|' || c.table_name::text || '|' || c.column_name::text || '|' || c.data_type::text
            || '|' || c.udt_name::text || '|' || c.is_nullable::text
            || '|' || coalesce(c.column_default, '')
FROM information_schema.columns c WHERE c.table_schema = :'schema'
UNION ALL
SELECT 'con|' || conrelid::regclass::text || '|' || conname::text || '|' || contype::text
            || '|' || pg_get_constraintdef(oid)
FROM pg_constraint, s WHERE connamespace = s.ns
UNION ALL
SELECT 'idx|' || tablename::text || '|' || indexname::text || '|' || indexdef
FROM pg_indexes WHERE schemaname = :'schema'
UNION ALL
SELECT 'trg|' || tgrelid::regclass::text || '|' || tgname::text || '|' || pg_get_triggerdef(oid)
FROM pg_trigger, s
WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE :'schema' || '.%'
UNION ALL
SELECT 'fn|' || p.proname::text || '|' || pg_get_functiondef(p.oid)
FROM pg_proc p, s WHERE p.pronamespace = s.ns
UNION ALL
SELECT 'rls|' || relname::text || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
FROM pg_class, s WHERE relnamespace = s.ns AND relkind = 'r'
UNION ALL
SELECT 'pol|' || polrelid::regclass::text || '|' || polname::text || '|' || polcmd::text
            || '|' || coalesce(pg_get_expr(polqual, polrelid), '')
            || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
FROM pg_policy, s WHERE polrelid::regclass::text LIKE :'schema' || '.%'
UNION ALL
SELECT 'grt|' || table_name::text || '|' || grantor::text || '|' || grantee::text
            || '|' || privilege_type::text || '|' || is_grantable::text
FROM information_schema.role_table_grants WHERE table_schema = :'schema'
ORDER BY 1;
SQL
}

base=$(signature zara_dev)
for schema in zara_qa zara_uat zara_prod; do
    if ! diff <(echo "$base") <(signature "$schema") >/dev/null; then
        echo "FAIL: schema drift between zara_dev and $schema:" >&2
        diff <(echo "$base") <(signature "$schema") >&2
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
