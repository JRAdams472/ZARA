-- Environment schema: append-only promotion history (MPE-113 §3.2).
-- Every promotion records which artifact moved, between which
-- environments, the SHA-256 of the promoted graph, who promoted it, and
-- when. Rows are never updated or deleted — enforced by trigger, not by
-- convention.
CREATE TABLE promotion_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    artifact_key TEXT NOT NULL,
    artifact_id  UUID NOT NULL,
    from_env     TEXT NOT NULL CHECK (from_env IN ('dev', 'qa', 'uat', 'prod')),
    to_env       TEXT NOT NULL CHECK (to_env   IN ('dev', 'qa', 'uat', 'prod')),
    graph_sha256 TEXT NOT NULL,
    promoted_by  TEXT NOT NULL,
    promoted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promotion_no_skip
        CHECK (from_env <> to_env)
);

CREATE INDEX idx_promotion_history_tenant
    ON promotion_history (tenant_id, artifact_key, promoted_at DESC);

CREATE FUNCTION promotion_history_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'promotion_history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER promotion_history_append_only
    BEFORE UPDATE OR DELETE ON promotion_history
    FOR EACH ROW EXECUTE FUNCTION promotion_history_block_mutation();
