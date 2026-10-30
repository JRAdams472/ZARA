#!/usr/bin/env bash
# HTTP eval-latency bench (MPE-142 Z2 phase 2).
#
# Mints an ephemeral devtoken (fresh RSA key + JWKS into .devkeys/),
# starts zara-engine against it if the port isn't already serving, then
# POSTs /api/evaluate/dev N times and reports p50/p95/p99/max wall time.
# Exits 1 when p95 exceeds --budget-ms (default 15).
#
#   tests/latency/bench.sh --tenant <uuid-or-slug> [--iterations 200] \
#       [--url http://localhost:8400] [--env dev] [--budget-ms 15] \
#       [--token <jwt>] [--no-start]
#
# Requires: curl, a seeded data plane (ENGINE_DATABASE_URL in env/.env),
# cargo (only when it needs to mint or start the service).
set -euo pipefail
cd "$(dirname "$0")/../.."

# 127.0.0.1, not localhost — keeps resolver/family fallback out of the
# measurement (localhost → ::1 when the socket is IPv4-only adds ~200 ms).
URL=http://127.0.0.1:8400
ENV_SLUG=dev
TENANT=""
ITER=200
BUDGET=15
TOKEN=${TOKEN:-}
NO_START=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --url) URL=$2; shift 2 ;;
        --env) ENV_SLUG=$2; shift 2 ;;
        --tenant) TENANT=$2; shift 2 ;;
        --iterations) ITER=$2; shift 2 ;;
        --budget-ms) BUDGET=$2; shift 2 ;;
        --token) TOKEN=$2; shift 2 ;;
        --no-start) NO_START=1; shift ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done
[[ -n $TENANT ]] || { echo "--tenant <uuid-or-slug> is required" >&2; exit 2; }

# .env supplies ENGINE_DATABASE_URL + ZARA_ENGINE_PASSWORD for local runs.
[[ -f .env ]] && { set -a; source .env; set +a; }

# Resolve the tenant UUID (slug ok) — needed for the tenant_id claim.
if [[ $TENANT =~ ^[0-9a-fA-F-]{36}$ ]]; then
    TENANT_ID=$TENANT
else
    TENANT_ID=$(psql "${MIGRATE_DATABASE_URL:-${DATABASE_URL:-${ENGINE_DATABASE_URL:?need a DSN to resolve tenant slug}}}" \
        -qAt -c "SELECT id FROM zara_control.tenants WHERE slug='$TENANT'")
    [[ -n $TENANT_ID ]] || { echo "tenant $TENANT not found" >&2; exit 1; }
fi

mkdir -p .devkeys

STARTED_PID=""
if [[ -z $TOKEN ]]; then
    TOKEN=$(cargo run -q -p zara-engine --bin zara_devtoken -- \
        --tenant-id "$TENANT_ID" --envs "$ENV_SLUG" \
        --jwks-out .devkeys/jwks.json --key-out .devkeys/dev.pem 2>/dev/null)
fi

if ! curl -sf "$URL/healthz" >/dev/null 2>&1; then
    (( NO_START )) && { echo "$URL not serving and --no-start set" >&2; exit 1; }
    echo "starting zara-engine against .devkeys/jwks.json ..."
    ZARA_JWKS_FILE=.devkeys/jwks.json OIDC_ISSUER=zara-devtoken OIDC_AUDIENCE=zara-engine \
        cargo run -q -p zara-engine --bin zara_engine & 
    STARTED_PID=$!
    trap '[[ -n $STARTED_PID ]] && kill $STARTED_PID 2>/dev/null || true' EXIT
    for _ in $(seq 1 60); do
        curl -sf "$URL/healthz" >/dev/null 2>&1 && break
        sleep 1
    done
    curl -sf "$URL/healthz" >/dev/null || { echo "engine did not come up" >&2; exit 1; }
fi

BODY=$(printf '{"tenantId":"%s","scenario":{"loan":{"purpose":"rateTermRefi","amount":500000},"borrower":{"vaEligible":true}}}' "$TENANT_ID")

echo "warmup..."
for _ in $(seq 1 10); do
    curl -sf -X POST "$URL/api/evaluate/$ENV_SLUG" \
        -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
        -d "$BODY" -o /dev/null
done

echo "measuring $ITER iterations..."
ms_values=$(for _ in $(seq 1 "$ITER"); do
    curl -sf -o /dev/null -w '%{time_total}\n' -X POST "$URL/api/evaluate/$ENV_SLUG" \
        -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
        -d "$BODY"
done)

echo "$ms_values" | awk -v budget="$BUDGET" '
{ ms[NR] = $1 * 1000 }
END {
    n = asort(ms)
    p50 = ms[int(n*0.50) < 1 ? 1 : int(n*0.50)]
    p95 = ms[int(n*0.95) < 1 ? 1 : int(n*0.95)]
    p99 = ms[int(n*0.99) < 1 ? 1 : int(n*0.99)]
    printf "iterations: %d\np50=%.2fms p95=%.2fms p99=%.2fms max=%.2fms budget=%dms %s\n",
        n, p50, p95, p99, ms[n], budget, (p95 < budget ? "PASS" : "FAIL")
    exit (p95 < budget ? 0 : 1)
}'
