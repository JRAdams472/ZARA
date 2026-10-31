-- Demo role grants (synthetic — Z5, MPE-168): binds the dev IdP identities
-- (dex static users in dex/config.dev.yaml) to Zara RBAC roles so the web
-- console's login flow resolves real principals. Runs as zara_migrate —
-- the owner is bound by FORCE RLS, so the tenant GUC is stamped first,
-- proving the guard is mandatory for writes.
--
-- Grants key on 'email' — dex `sub` values are connector-encoded and not
-- human-stable; emails are. Prod bindings would key on IdP 'sub'.
-- ON CONFLICT makes the file safe to re-run.

\set ON_ERROR_STOP on

SET search_path = zara_control;

-- ACME — the primary demo tenant (acme-mortgage).
SELECT set_config('zara.tenant_id', 'aa5ce000-0000-4000-8000-0000000000ac', false);
INSERT INTO role_grants (tenant_id, subject_type, subject, role, granted_by) VALUES
    ('aa5ce000-0000-4000-8000-0000000000ac', 'email', 'admin@zara.dev',      'tenant_release_manager', 'seed'),
    ('aa5ce000-0000-4000-8000-0000000000ac', 'email', 'releasemgr@zara.dev', 'tenant_release_manager', 'seed'),
    ('aa5ce000-0000-4000-8000-0000000000ac', 'email', 'engineer@zara.dev',   'tenant_rule_engineer',   'seed'),
    ('aa5ce000-0000-4000-8000-0000000000ac', 'email', 'auditor@zara.dev',    'tenant_auditor',         'seed')
ON CONFLICT (tenant_id, subject_type, subject, role) DO NOTHING;

-- Northstar — auditor only: demonstrates the same identity can hold
-- different scope per tenant (qa/uat read, nothing else).
SELECT set_config('zara.tenant_id', 'bb0215a0-0000-4000-8000-0000000000b2', false);
INSERT INTO role_grants (tenant_id, subject_type, subject, role, granted_by) VALUES
    ('bb0215a0-0000-4000-8000-0000000000b2', 'email', 'auditor@zara.dev', 'tenant_auditor', 'seed')
ON CONFLICT (tenant_id, subject_type, subject, role) DO NOTHING;
