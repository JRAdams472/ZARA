-- Environment schema: keep _sqlx_migrations out of zara_engine's reach.
-- Bootstrap 0003's default privileges would otherwise leave the engine
-- with SELECT on the ledger (created by zara_migrate after the defaults).
-- Ledger rows are the migrate role's bookkeeping only — same hardening
-- as 0005_tighten_grants for the app/promote roles.
REVOKE ALL ON TABLE _sqlx_migrations FROM zara_engine;
