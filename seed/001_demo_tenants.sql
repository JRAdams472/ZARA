-- Demo tenants (synthetic, fixed UUIDs — MPE-148).
-- Runs as zara_migrate: the only role that writes zara_control.tenants.
-- Fixed IDs keep downstream fixtures and the isolation suite deterministic;
-- ON CONFLICT makes the file safe to re-run.
INSERT INTO zara_control.tenants (id, slug, name) VALUES
    ('aa5ce000-0000-4000-8000-0000000000ac', 'acme-mortgage',     'Acme Mortgage (demo)'),
    ('bb0215a0-0000-4000-8000-0000000000b2', 'northstar-lending', 'Northstar Lending (demo)')
ON CONFLICT (slug) DO NOTHING;
