#!/usr/bin/env bash
# t02 — an environment app role cannot reach another environment's schema.
source "$(dirname "$0")/lib.sh"

echo "t02: cross-schema isolation"

for schema in zara_qa zara_uat zara_prod; do
    expect_fail zara_app_dev ZARA_APP_DEV_PASSWORD "permission denied" \
        -c "SELECT count(*) FROM ${schema}.rule_artifacts;" \
        || exit 1
    echo "  zara_app_dev -> ${schema}: denied"
done

echo "t02 OK"
