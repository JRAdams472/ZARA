-- Bootstrap: management-plane role (Z3, MPE-143).
-- zara_mgmt is control-schema only: it reads the tenant/environment
-- registry and owns grants/secrets/control-audit writes. It never touches
-- env schemas — rule-artifact writes stay on zara_app_* (drafts) and
-- zara_promote (promotion, Z4). No default privileges: the control
-- migration grants explicitly so _sqlx_migrations stays unreachable.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zara_mgmt') THEN
        CREATE ROLE zara_mgmt LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA zara_control TO zara_mgmt;
