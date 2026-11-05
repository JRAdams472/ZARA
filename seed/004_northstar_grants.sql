-- Northstar writer persona grants (synthetic — Z6, MPE-178): binds the
-- second demo identity ns-engineer@zara.dev (dex/config.dev.yaml) to the
-- Northstar tenant so two-tenant isolation is exercisable end-to-end —
-- Acme's engineer@zara.dev cannot see Northstar rows and vice versa.
-- Runs as zara_migrate; FORCE RLS still requires the tenant GUC.
-- ON CONFLICT makes the file safe to re-run.

\set ON_ERROR_STOP on

SET search_path = zara_control;

SELECT set_config('zara.tenant_id', 'bb0215a0-0000-4000-8000-0000000000b2', false);
INSERT INTO role_grants (tenant_id, subject_type, subject, role, granted_by) VALUES
    ('bb0215a0-0000-4000-8000-0000000000b2', 'email', 'ns-engineer@zara.dev', 'tenant_rule_engineer', 'seed')
ON CONFLICT (tenant_id, subject_type, subject, role) DO NOTHING;
