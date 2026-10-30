-- Bootstrap: management-plane role search_path (Z3, MPE-143).
-- Application SQL schema-qualifies every control table, so this is a
-- convenience for ad-hoc psql sessions under zara_mgmt — not a
-- correctness dependency. zara_control only: env schemas stay invisible
-- (no USAGE grant) regardless of path.
ALTER ROLE zara_mgmt IN DATABASE zara SET search_path = zara_control, public;
