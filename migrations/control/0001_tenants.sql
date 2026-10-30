-- Control plane: tenant registry. No tenant RLS here — this IS the
-- registry every tenant's rows point back to; read-only for app roles.
CREATE TABLE zara_control.tenants (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
