-- Control plane: the four promotion environments (ADR-0002). `ordinal`
-- encodes the DEV→QA→UAT→PROD ordering the no-skip rule enforces (Z4).
CREATE TABLE zara_control.environments (
    name         TEXT PRIMARY KEY CHECK (name IN ('dev', 'qa', 'uat', 'prod')),
    ordinal      INTEGER NOT NULL UNIQUE,
    display_name TEXT NOT NULL
);

INSERT INTO zara_control.environments (name, ordinal, display_name) VALUES
    ('dev',  0, 'Development'),
    ('qa',   1, 'QA'),
    ('uat',  2, 'UAT'),
    ('prod', 3, 'Production');
