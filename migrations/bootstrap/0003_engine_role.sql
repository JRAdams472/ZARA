-- Bootstrap: dedicated read role for the execution engine (Z2, MPE-142).
-- zara_engine = SELECT-only across zara_control + all four env schemas —
-- the least-privilege shape of the snapshot loader (zara_promote also
-- carries INSERT and stays the promotion path only). FORCE RLS still
-- applies: the loader must stamp zara.tenant_id per tenant to see rows.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_engine') THEN
        CREATE ROLE zara_engine LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA zara_control, zara_dev, zara_qa, zara_uat, zara_prod TO zara_engine;

-- Fresh-DB ordering: bootstrap runs before the control/env tables exist —
-- default privileges cover the objects zara_migrate creates later.
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_control
    GRANT SELECT ON TABLES TO zara_engine;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_dev
    GRANT SELECT ON TABLES TO zara_engine;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_qa
    GRANT SELECT ON TABLES TO zara_engine;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_uat
    GRANT SELECT ON TABLES TO zara_engine;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_prod
    GRANT SELECT ON TABLES TO zara_engine;

-- Existing-DB ordering: grant on the tables already present. Migration
-- ledgers are excluded — engine reads artifacts, never bookkeeping.
DO $$
DECLARE
    s TEXT;
    t TEXT;
BEGIN
    FOR s IN SELECT unnest(ARRAY['zara_control','zara_dev','zara_qa','zara_uat','zara_prod']) LOOP
        FOR t IN SELECT tablename FROM pg_tables
                 WHERE schemaname = s AND tablename <> '_sqlx_migrations' LOOP
            EXECUTE format('GRANT SELECT ON TABLE %I.%I TO zara_engine', s, t);
        END LOOP;
    END LOOP;
END
$$;
