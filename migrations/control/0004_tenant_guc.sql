-- Fail-loud tenant GUC guard for zara_control (MPE-166) — same contract
-- as the env schemas: missing or empty zara.tenant_id raises instead of
-- silently denying or erroring incidentally.
CREATE OR REPLACE FUNCTION tenant_guc() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE
    v text := current_setting('zara.tenant_id', true);
BEGIN
    IF v IS NULL OR v = '' THEN
        RAISE EXCEPTION
            'zara.tenant_id is not set — tenant-scoped queries must stamp the GUC (ADR-0002)'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN v::uuid;
END
$$;

DROP POLICY tenant_isolation ON role_grants;
CREATE POLICY tenant_isolation ON role_grants
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());

DROP POLICY tenant_isolation ON tenant_secrets;
CREATE POLICY tenant_isolation ON tenant_secrets
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());

DROP POLICY tenant_isolation ON audit_events;
CREATE POLICY tenant_isolation ON audit_events
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());
