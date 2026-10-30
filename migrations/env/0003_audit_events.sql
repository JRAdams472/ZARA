-- Environment schema: append-only, hash-chained audit trail (MPEx
-- audit.rs pattern). `hash` chains each event to its predecessor so
-- out-of-band edits break verify_chain; the trigger rejects UPDATE and
-- DELETE outright. Writers land with the management plane (Z3) — the
-- schema is laid out now so RLS coverage is complete from the start.
CREATE TABLE audit_events (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_sub   TEXT NOT NULL,
    action      TEXT NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}',
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL UNIQUE
);

CREATE INDEX audit_events_occurred_at ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_tenant      ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_actor       ON audit_events (actor_sub);
CREATE INDEX audit_events_action      ON audit_events (action);

CREATE FUNCTION audit_events_block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();
