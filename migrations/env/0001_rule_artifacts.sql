-- Environment schema: fee rule artifacts (ADR-0002, docs/fee-model.md).
-- Runs inside each zara_{env} schema via SET search_path — keep names
-- unqualified so the same file produces identical DDL in all four.
--
-- Fee model: one `base_fee` artifact decides whether a fee is charged and
-- its base amount; an `adjustment_set` artifact carries the ordered
-- alteration rules applied on top. `spec` is the authoring format; `jdm`
-- is the compiled graph produced at write time (MPEx matrix pattern) so
-- drafts and published rows evaluate identically.
--
-- Drafts are working copies (UPDATE in place, unique per tenant+key).
-- Published rows are immutable snapshots — the trigger rejects UPDATE and
-- DELETE on them; promotion writes new rows, never mutates.
CREATE TABLE rule_artifacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    key          TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('base_fee', 'adjustment_set')),
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    spec         JSONB NOT NULL,
    jdm          JSONB NOT NULL,
    sha256       TEXT,
    created_by   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    CONSTRAINT rule_artifacts_published_at
        CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX idx_rule_artifacts_tenant_key
    ON rule_artifacts (tenant_id, key, status, published_at DESC);

CREATE UNIQUE INDEX uniq_rule_artifacts_draft
    ON rule_artifacts (tenant_id, key) WHERE status = 'draft';
CREATE UNIQUE INDEX uniq_rule_artifacts_pub
    ON rule_artifacts (tenant_id, key, published_at) WHERE status = 'published';

CREATE FUNCTION rule_artifacts_block_published_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'published rule_artifacts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rule_artifacts_immutable_published
    BEFORE UPDATE OR DELETE ON rule_artifacts
    FOR EACH ROW WHEN (OLD.status = 'published')
    EXECUTE FUNCTION rule_artifacts_block_published_mutation();
