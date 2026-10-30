-- Bootstrap: grants + default privileges. Runs once as the admin role,
-- BEFORE the env/control sets create tables — default privileges mean
-- every object zara_migrate creates later arrives with the right grants.
--
--   zara_app_<env>  own schema only: USAGE + table DML + sequence usage.
--                   Cannot even name another environment's schema.
--   zara_promote    cross-schema but read/append-only: SELECT+INSERT on
--                   tables — can copy an artifact forward and record the
--                   promotion, can never UPDATE or DELETE.

-- Schema usage — own environment only.
GRANT USAGE ON SCHEMA zara_dev  TO zara_app_dev;
GRANT USAGE ON SCHEMA zara_qa   TO zara_app_qa;
GRANT USAGE ON SCHEMA zara_uat  TO zara_app_uat;
GRANT USAGE ON SCHEMA zara_prod TO zara_app_prod;

-- Schema usage — promotion role spans all four (the only sanctioned path).
GRANT USAGE ON SCHEMA zara_dev  TO zara_promote;
GRANT USAGE ON SCHEMA zara_qa   TO zara_promote;
GRANT USAGE ON SCHEMA zara_uat  TO zara_promote;
GRANT USAGE ON SCHEMA zara_prod TO zara_promote;

-- Control schema is read-only for every service role (tenant registry).
GRANT USAGE ON SCHEMA zara_control TO zara_app_dev, zara_app_qa, zara_app_uat, zara_app_prod, zara_promote;

-- Default privileges for objects created BY zara_migrate.
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_dev
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zara_app_dev;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_qa
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zara_app_qa;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_uat
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zara_app_uat;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_prod
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zara_app_prod;

ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_dev
    GRANT SELECT, INSERT ON TABLES TO zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_qa
    GRANT SELECT, INSERT ON TABLES TO zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_uat
    GRANT SELECT, INSERT ON TABLES TO zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_prod
    GRANT SELECT, INSERT ON TABLES TO zara_promote;

ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_control
    GRANT SELECT ON TABLES TO zara_app_dev, zara_app_qa, zara_app_uat, zara_app_prod, zara_promote;

-- Sequences (bigserial audit ids) need USAGE for inserts.
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_dev
    GRANT USAGE ON SEQUENCES TO zara_app_dev, zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_qa
    GRANT USAGE ON SEQUENCES TO zara_app_qa, zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_uat
    GRANT USAGE ON SEQUENCES TO zara_app_uat, zara_promote;
ALTER DEFAULT PRIVILEGES FOR ROLE zara_migrate IN SCHEMA zara_prod
    GRANT USAGE ON SEQUENCES TO zara_app_prod, zara_promote;
