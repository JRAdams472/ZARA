-- Demo fee artifacts (synthetic — MPE-148, docs/fee-model.md).
-- Runs as zara_migrate. Even the owner is bound by FORCE ROW LEVEL
-- SECURITY, so `SET zara.tenant_id` precedes every tenant's inserts —
-- the fixture itself proves the GUC is mandatory for writes.
--
-- Layout per tenant:
--   dev  : published pair + editable draft pair (drafts live in dev only)
--   qa/uat/prod : published pair only (mirrors the promotion lifecycle)
--   published_at steps dev→qa→uat→prod, mirroring promotion order.
-- sha256 is computed over the canonical jsonb text of the jdm graph —
-- the same value Z4's promotion path will recompute and compare.
--
-- Idempotent: drafts/published rows hit the partial unique indexes via
-- ON CONFLICT arbiters, so re-runs insert nothing.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- acme-mortgage — the docs/fee-model.md worked example:
--   $900 origination on refinances, veteran −500, high-balance +250, floor 0.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE demo_seed AS
SELECT * FROM (VALUES
    -- tenant_id, env_order_offset, spec/jdm for base_fee
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'origination', 'base_fee',
     $${
       "feeCode": "origination",
       "tridBucket": "A",
       "when": {"loan.purpose": {"in": ["rateTermRefi", "cashOutRefi"]}},
       "amount": 900
     }$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Origination base fee",
          "position": {"x": 280, "y": 0},
          "content": {
            "hitPolicy": "first",
            "inputs":  [{"id": "i1", "name": "Loan purpose", "field": "loan.purpose"}],
            "outputs": [
              {"id": "o1", "name": "charged",    "field": "charged"},
              {"id": "o2", "name": "amount",     "field": "amount"},
              {"id": "o3", "name": "feeCode",    "field": "feeCode"},
              {"id": "o4", "name": "tridBucket", "field": "tridBucket"}
            ],
            "rules": [
              {"_id": "r1", "i1": "'rateTermRefi'", "o1": "true", "o2": "900", "o3": "'origination'", "o4": "'A'"},
              {"_id": "r2", "i1": "'cashOutRefi'",  "o1": "true", "o2": "900", "o3": "'origination'", "o4": "'A'"},
              {"_id": "r3",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'origination-adj', 'adjustment_set',
     $${
       "appliesTo": "origination",
       "rules": [
         {"id": "veteran-discount",   "when": {"borrower.vaEligible": {"eq": true}}, "op": "add",       "value": -500},
         {"id": "high-balance",       "when": {"loan.amount": {"gt": 647200}},        "op": "add",       "value": 250},
         {"id": "non-negative-floor", "when": {"always": true},                       "op": "cap_floor", "value": 0}
       ]
     }$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Origination adjustments",
          "position": {"x": 280, "y": 0},
          "content": {
            "hitPolicy": "collect",
            "inputs": [
              {"id": "i1", "name": "VA eligible", "field": "borrower.vaEligible"},
              {"id": "i2", "name": "Loan amount", "field": "loan.amount"}
            ],
            "outputs": [
              {"id": "o1", "name": "rule",  "field": "adjustments[].rule"},
              {"id": "o2", "name": "op",    "field": "adjustments[].op"},
              {"id": "o3", "name": "value", "field": "adjustments[].value"}
            ],
            "rules": [
              {"_id": "r1", "i1": "true",     "o1": "'veteran-discount'",    "o2": "'add'",       "o3": "-500"},
              {"_id": "r2", "i2": "> 647200", "o1": "'high-balance'",        "o2": "'add'",       "o3": "250"},
              {"_id": "r3",                  "o1": "'non-negative-floor'",  "o2": "'cap_floor'", "o3": "0"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Adjustments", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$)
) AS v(tenant_id, key, kind, spec, jdm);

-- ---------------------------------------------------------------------------
-- northstar-lending — visibly different schedule (its own rule matrix):
--   $1,200 origination on refinances, first-responder −400, high-balance
--   +300, floor 0. Its dev draft is a pending edit: amount 1250.
-- ---------------------------------------------------------------------------
INSERT INTO demo_seed
SELECT * FROM (VALUES
    ('bb0215a0-0000-4000-8000-0000000000b2'::uuid, 'origination', 'base_fee',
     $${
       "feeCode": "origination",
       "tridBucket": "A",
       "when": {"loan.purpose": {"in": ["rateTermRefi", "cashOutRefi"]}},
       "amount": 1200
     }$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Origination base fee",
          "position": {"x": 280, "y": 0},
          "content": {
            "hitPolicy": "first",
            "inputs":  [{"id": "i1", "name": "Loan purpose", "field": "loan.purpose"}],
            "outputs": [
              {"id": "o1", "name": "charged",    "field": "charged"},
              {"id": "o2", "name": "amount",     "field": "amount"},
              {"id": "o3", "name": "feeCode",    "field": "feeCode"},
              {"id": "o4", "name": "tridBucket", "field": "tridBucket"}
            ],
            "rules": [
              {"_id": "r1", "i1": "'rateTermRefi'", "o1": "true", "o2": "1200", "o3": "'origination'", "o4": "'A'"},
              {"_id": "r2", "i1": "'cashOutRefi'",  "o1": "true", "o2": "1200", "o3": "'origination'", "o4": "'A'"},
              {"_id": "r3",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),
    ('bb0215a0-0000-4000-8000-0000000000b2'::uuid, 'origination-adj', 'adjustment_set',
     $${
       "appliesTo": "origination",
       "rules": [
         {"id": "first-responder-discount", "when": {"borrower.firstResponder": {"eq": true}}, "op": "add",       "value": -400},
         {"id": "high-balance",             "when": {"loan.amount": {"gt": 647200}},            "op": "add",       "value": 300},
         {"id": "non-negative-floor",       "when": {"always": true},                            "op": "cap_floor", "value": 0}
       ]
     }$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Origination adjustments",
          "position": {"x": 280, "y": 0},
          "content": {
            "hitPolicy": "collect",
            "inputs": [
              {"id": "i1", "name": "First responder", "field": "borrower.firstResponder"},
              {"id": "i2", "name": "Loan amount",     "field": "loan.amount"}
            ],
            "outputs": [
              {"id": "o1", "name": "rule",  "field": "adjustments[].rule"},
              {"id": "o2", "name": "op",    "field": "adjustments[].op"},
              {"id": "o3", "name": "value", "field": "adjustments[].value"}
            ],
            "rules": [
              {"_id": "r1", "i1": "true",     "o1": "'first-responder-discount'", "o2": "'add'",       "o3": "-400"},
              {"_id": "r2", "i2": "> 647200", "o1": "'high-balance'",             "o2": "'add'",       "o3": "300"},
              {"_id": "r3",                  "o1": "'non-negative-floor'",       "o2": "'cap_floor'", "o3": "0"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Adjustments", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$)
) AS v(tenant_id, key, kind, spec, jdm);

-- ---------------------------------------------------------------------------
-- Insert published pairs into every env schema. published_at steps one week
-- per promotion stage so the fixtures read like a completed DEV→PROD chain.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    env    TEXT;
    step   INT := 0;
    pub_ts TIMESTAMPTZ;
    t      UUID;
BEGIN
    FOR env IN SELECT unnest(ARRAY['zara_dev','zara_qa','zara_uat','zara_prod']) LOOP
        pub_ts := TIMESTAMPTZ '2026-01-05 00:00:00+00' + (step || ' weeks')::interval;
        step := step + 1;
        EXECUTE format('SET search_path = %I', env);
        FOR t IN SELECT DISTINCT tenant_id FROM demo_seed LOOP
            PERFORM set_config('zara.tenant_id', t::text, false);
            EXECUTE format(
                'INSERT INTO %I.rule_artifacts
                     (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at)
                 SELECT tenant_id, key, kind, ''published'', spec::jsonb, jdm::jsonb,
                        encode(sha256(convert_to(jdm::jsonb::text, ''UTF8'')), ''hex''),
                        ''seed'', %L
                 FROM demo_seed WHERE tenant_id = %L
                 ON CONFLICT (tenant_id, key, published_at) WHERE status = ''published''
                 DO NOTHING', env, pub_ts, t);
        END LOOP;
    END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- dev-only drafts: the working copies a rule engineer would edit. northstar's
-- base_fee draft is a pending amount change (1250 vs published 1200) so the
-- draft/published duality is visible in demos.
-- ---------------------------------------------------------------------------
SET search_path = zara_dev;

SELECT set_config('zara.tenant_id', 'aa5ce000-0000-4000-8000-0000000000ac', false);
INSERT INTO rule_artifacts (tenant_id, key, kind, status, spec, jdm, created_by)
SELECT tenant_id, key, kind, 'draft', spec::jsonb, jdm::jsonb, 'seed'
FROM demo_seed
WHERE tenant_id = 'aa5ce000-0000-4000-8000-0000000000ac'
ON CONFLICT (tenant_id, key) WHERE status = 'draft' DO NOTHING;

SELECT set_config('zara.tenant_id', 'bb0215a0-0000-4000-8000-0000000000b2', false);
INSERT INTO rule_artifacts (tenant_id, key, kind, status, spec, jdm, created_by)
SELECT tenant_id, key, kind, 'draft',
       CASE WHEN key = 'origination'
            THEN jsonb_set(spec::jsonb, '{amount}', '1250')
            ELSE spec::jsonb END,
       jdm::jsonb, 'seed'
FROM demo_seed
WHERE tenant_id = 'bb0215a0-0000-4000-8000-0000000000b2'
ON CONFLICT (tenant_id, key) WHERE status = 'draft' DO NOTHING;

DROP TABLE demo_seed;
