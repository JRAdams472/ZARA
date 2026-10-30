-- Control schema: management-plane tables (Z3, MPE-143).
-- role_grants: OIDC subject -> tenant-scoped RBAC role, resolved per
-- request by the mgmt plane — the IdP never needs to know Zara roles.
-- tenant_secrets: sensitive config fields stored as AES-256-GCM
-- ciphertext via the KMS seam (Phase 2 writes through it).
-- audit_events: control-plane append-only hash chain — same shape as the
-- env-schema tables (env/0003); covers grants/secrets mutations.
-- All three are tenant-scoped under FORCE RLS via the zara.tenant_id GUC.

CREATE TABLE role_grants (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('sub', 'email', 'aud')),
    subject      TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN (
                     'tenant_auditor',
                     'tenant_rule_engineer',
                     'tenant_release_manager')),
    granted_by   TEXT NOT NULL,
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, subject_type, subject, role)
);

CREATE INDEX role_grants_lookup
    ON role_grants (tenant_id, subject_type, subject);

CREATE TABLE tenant_secrets (
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,          -- transit envelope (vault:v1:…)
    key_name    TEXT NOT NULL,          -- transit key that sealed it
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NOT NULL,
    PRIMARY KEY (tenant_id, name)
);

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

-- RLS: same fail-closed GUC policy as the env schemas — unset
-- zara.tenant_id means zero rows, even for the owner (FORCE).
ALTER TABLE role_grants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_grants    FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events   FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON role_grants
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON tenant_secrets
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON audit_events
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);

-- Explicit grants for zara_mgmt — named tables only, no ledger.
GRANT SELECT ON tenants, environments, role_grants, tenant_secrets, audit_events TO zara_mgmt;
GRANT INSERT, UPDATE, DELETE ON role_grants    TO zara_mgmt;
GRANT INSERT, UPDATE          ON tenant_secrets TO zara_mgmt;
GRANT INSERT                  ON audit_events   TO zara_mgmt;
GRANT USAGE ON SEQUENCE role_grants_id_seq, audit_events_id_seq TO zara_mgmt;
