-- Environment schema: tenant isolation via Row-Level Security (ADR-0002).
-- ENABLE + FORCE on every table — even the owner (zara_migrate) is
-- subject, so no role short of a superuser can read cross-tenant rows by
-- accident. current_setting('zara.tenant_id', true) returns NULL when the
-- GUC is unset, and NULL-compare denies every row: **no GUC = zero rows**.
-- The middleware stamps `SET LOCAL zara.tenant_id` from verified JWT
-- claims — never from request payloads.

ALTER TABLE rule_artifacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_artifacts     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rule_artifacts
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);

ALTER TABLE promotion_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_history  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON promotion_history
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);

ALTER TABLE audit_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
    USING      (tenant_id = current_setting('zara.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('zara.tenant_id', true)::uuid);
