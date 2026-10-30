-- Environment schema: tighten ledger grants. Default privileges gave the
-- app + promote roles DML on _sqlx_migrations too — an app role could
-- erase or forge migration history in its own schema. The ledger is the
-- migrate role's bookkeeping only.
DO $$
DECLARE
    app_role TEXT := 'zara_app_' || replace(current_schema(), 'zara_', '');
BEGIN
    EXECUTE format('REVOKE ALL ON TABLE _sqlx_migrations FROM %I', app_role);
END
$$;

REVOKE ALL ON TABLE _sqlx_migrations FROM zara_promote;
