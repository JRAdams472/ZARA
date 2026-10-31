-- Fail-loud tenant GUC guard (MPE-166, locked decision).
-- Before: policies read current_setting('zara.tenant_id', true)::uuid
-- inline — a missing GUC errored on ''::uuid by accident, and a NULL GUC
-- (never set) silently denied all rows. Now one named guard makes the
-- contract explicit: missing OR empty GUC raises a descriptive error —
-- a tenant-scoped query without the GUC is a BUG and must scream, never
-- degrade quietly. SECURITY INVOKER (default): the guard only reads a
-- session variable.
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

DROP POLICY tenant_isolation ON rule_artifacts;
CREATE POLICY tenant_isolation ON rule_artifacts
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());

DROP POLICY tenant_isolation ON promotion_history;
CREATE POLICY tenant_isolation ON promotion_history
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());

DROP POLICY tenant_isolation ON audit_events;
CREATE POLICY tenant_isolation ON audit_events
    USING      (tenant_id = tenant_guc())
    WITH CHECK (tenant_id = tenant_guc());
