#!/usr/bin/env bash
# t04 — append-only tables reject UPDATE/DELETE for EVERY role (triggers
# fire even for the superuser), and published artifacts are immutable.
# Fixture rows are required: BEFORE-ROW triggers only fire on real rows.
source "$(dirname "$0")/lib.sh"

echo "t04: append-only + published immutability"

psql_admin -c "
    INSERT INTO zara_dev.promotion_history
        (tenant_id,artifact_key,artifact_id,from_env,to_env,graph_sha256,promoted_by)
    VALUES ('$TENANT_A','iso-x',gen_random_uuid(),'dev','qa','deadbeef','iso');
    INSERT INTO zara_dev.audit_events
        (tenant_id,occurred_at,actor_sub,action,prev_hash,hash)
    VALUES ('$TENANT_A',now(),'iso','iso.test','','h1')
    ON CONFLICT (hash) DO NOTHING;
"

expect_fail "$ADMIN_USER" POSTGRES_PASSWORD "append-only" \
    -c "UPDATE zara_dev.promotion_history SET promoted_by='x' WHERE true;" || exit 1
expect_fail "$ADMIN_USER" POSTGRES_PASSWORD "append-only" \
    -c "DELETE FROM zara_dev.audit_events WHERE true;" || exit 1
expect_fail "$ADMIN_USER" POSTGRES_PASSWORD "immutable" \
    -c "UPDATE zara_dev.rule_artifacts SET spec='{}' WHERE status='published';" || exit 1
expect_fail "$ADMIN_USER" POSTGRES_PASSWORD "immutable" \
    -c "DELETE FROM zara_dev.rule_artifacts WHERE status='published';" || exit 1

echo "t04 OK"
