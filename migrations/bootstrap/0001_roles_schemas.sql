-- Bootstrap: roles + schemas (ADR-0002). Runs once as the admin role.
-- Passwords are provisioned by `zara-migrate --set-role-passwords` from
-- ZARA_*_PASSWORD env vars — never stored in SQL.
--
-- Role model:
--   zara_migrate      DDL owner; subject to FORCE RLS for DML (non-superuser
--                     so the owner can't accidentally bypass tenant isolation)
--   zara_app_<env>    data-plane role for services; its own env schema only
--   zara_promote      the ONLY sanctioned cross-schema role — promotion path

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_migrate') THEN
        CREATE ROLE zara_migrate LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_app_dev') THEN
        CREATE ROLE zara_app_dev LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_app_qa') THEN
        CREATE ROLE zara_app_qa LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_app_uat') THEN
        CREATE ROLE zara_app_uat LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_app_prod') THEN
        CREATE ROLE zara_app_prod LOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_promote') THEN
        CREATE ROLE zara_promote LOGIN;
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS zara_control AUTHORIZATION zara_migrate;
CREATE SCHEMA IF NOT EXISTS zara_dev  AUTHORIZATION zara_migrate;
CREATE SCHEMA IF NOT EXISTS zara_qa   AUTHORIZATION zara_migrate;
CREATE SCHEMA IF NOT EXISTS zara_uat  AUTHORIZATION zara_migrate;
CREATE SCHEMA IF NOT EXISTS zara_prod AUTHORIZATION zara_migrate;

-- Deny-by-default: strip any ambient PUBLIC access to Zara schemas.
REVOKE ALL ON SCHEMA zara_control FROM PUBLIC;
REVOKE ALL ON SCHEMA zara_dev  FROM PUBLIC;
REVOKE ALL ON SCHEMA zara_qa   FROM PUBLIC;
REVOKE ALL ON SCHEMA zara_uat  FROM PUBLIC;
REVOKE ALL ON SCHEMA zara_prod FROM PUBLIC;
