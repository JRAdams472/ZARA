#!/usr/bin/env bash
# Shared helpers for the Zara isolation suite (MPE-141).
# Reads PGHOST/PGPORT/PGDATABASE + role passwords from env; never hardcodes
# secrets. Every test asserts a concrete DB-enforced boundary.
set -euo pipefail

PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5532}
PGDATABASE=${PGDATABASE:-zara}
ADMIN_USER=${ADMIN_USER:-zara}
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required (admin role password)}"

dsn() { # dsn <role> <password-env-var>
    local role=$1 pwvar=$2 pw=""
    pw=$(printenv "$pwvar" || true)
    printf 'postgres://%s:%s@%s:%s/%s' "$role" "$pw" "$PGHOST" "$PGPORT" "$PGDATABASE"
}

admin_dsn() { dsn "$ADMIN_USER" POSTGRES_PASSWORD; }

# Run SQL as admin (superuser — bypasses RLS, used for fixtures only).
psql_admin() { psql "$(admin_dsn)" -v ON_ERROR_STOP=1 -qAt "$@"; }

# Run SQL as an application role.
psql_as() { # psql_as <role> <password-env-var> <psql-args...>
    local role=$1 pwvar=$2
    shift 2
    psql "$(dsn "$role" "$pwvar")" -v ON_ERROR_STOP=1 -qAt "$@"
}

# Scalar value of the LAST statement in a multi-statement -c string
# (SET …; SELECT …) — SET echoes a "SET" row, so take the last line.
scalar() { tail -1 | tr -d '[:space:]'; }

# expect_fail <role> <pwvar> <expected-error-substring> <psql-args...>
# Requires the command to fail AND the error to contain the substring.
expect_fail() {
    local role=$1 pwvar=$2 needle=$3
    shift 3
    local out rc=0
    out=$(psql_as "$role" "$pwvar" "$@" 2>&1) || rc=$?
    if [[ $rc -eq 0 ]]; then
        echo "FAIL: expected error containing '$needle' but command succeeded: $*" >&2
        return 1
    fi
    if ! grep -qiF "$needle" <<<"$out"; then
        echo "FAIL: expected error containing '$needle', got: $out" >&2
        return 1
    fi
}
