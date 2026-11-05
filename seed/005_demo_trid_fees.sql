-- Demo TRID fee matrix (synthetic — MPE-181, docs/fee-model.md).
-- Runs as zara_migrate; same FORCE-RLS GUC discipline as 002.
--
-- Extends the Acme demo tenant from the single origination pair to a
-- realistic closing-cost lineup so `POST /api/evaluate/{env}` returns a
-- TRID-categorized payload an integration consumer can render directly.
-- Northstar is intentionally untouched — its two-artifact matrix stays
-- the contrast fixture for tenant-isolation demos.
--
-- Layout: published rows in every env schema (dev/qa/uat/prod), mirroring
-- the promotion lifecycle. No dev drafts — the origination pair already
-- demonstrates the draft/published duality; thirteen more drafts would
-- only clutter the working-copy list.
--
-- Expression-priced fees (discount-points, transfer-tax, prepaid-interest)
-- emit zen-expressions in the amount cell — output cells evaluate against
-- the full scenario context, so `loan.amount` resolves without declaring
-- it as a table input.
--
-- Uncharged fees still emit a zero line (feeCode + tridBucket, total 0) —
-- eval's contract is one line per published base_fee; consumers filter on
-- total > 0 for the applicable set.
--
-- Idempotent: same partial-unique-index arbiters as 002.

\set ON_ERROR_STOP on

CREATE TEMP TABLE trid_seed AS
SELECT * FROM (VALUES
    -- tenant_id, key, kind, spec, jdm

    -- ======================= Bucket A — Origination charges =======================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'underwriting', 'base_fee',
     $${"feeCode":"underwriting","tridBucket":"A","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":795}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Underwriting fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "795", "o3": "'underwriting'", "o4": "'A'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "795", "o3": "'underwriting'", "o4": "'A'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "795", "o3": "'underwriting'", "o4": "'A'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'processing', 'base_fee',
     $${"feeCode":"processing","tridBucket":"A","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":450}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Processing fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "450", "o3": "'processing'", "o4": "'A'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "450", "o3": "'processing'", "o4": "'A'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "450", "o3": "'processing'", "o4": "'A'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'discount-points', 'base_fee',
     $${"feeCode":"discount-points","tridBucket":"A","when":{"borrower.discountPoints":{"eq":true}},"amount":"loan.amount * 0.0025"}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Discount points (0.25% of amount)",
          "position": {"x": 280, "y": 0},
          "content": {
            "hitPolicy": "first",
            "inputs":  [{"id": "i1", "name": "Points opted in", "field": "borrower.discountPoints"}],
            "outputs": [
              {"id": "o1", "name": "charged",    "field": "charged"},
              {"id": "o2", "name": "amount",     "field": "amount"},
              {"id": "o3", "name": "feeCode",    "field": "feeCode"},
              {"id": "o4", "name": "tridBucket", "field": "tridBucket"}
            ],
            "rules": [
              {"_id": "r1", "i1": "true", "o1": "true", "o2": "loan.amount * 0.0025", "o3": "'discount-points'", "o4": "'A'"},
              {"_id": "r2",         "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ================== Bucket B — Services borrower did NOT shop for ==============
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'appraisal', 'base_fee',
     $${"feeCode":"appraisal","tridBucket":"B","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":650}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Appraisal fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "650", "o3": "'appraisal'", "o4": "'B'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "650", "o3": "'appraisal'", "o4": "'B'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "650", "o3": "'appraisal'", "o4": "'B'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'credit-report', 'base_fee',
     $${"feeCode":"credit-report","tridBucket":"B","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":45}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Credit report fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "45", "o3": "'credit-report'", "o4": "'B'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "45", "o3": "'credit-report'", "o4": "'B'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "45", "o3": "'credit-report'", "o4": "'B'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'flood-cert', 'base_fee',
     $${"feeCode":"flood-cert","tridBucket":"B","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":15}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Flood certification fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "15", "o3": "'flood-cert'", "o4": "'B'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "15", "o3": "'flood-cert'", "o4": "'B'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "15", "o3": "'flood-cert'", "o4": "'B'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ============== Bucket C — Services borrower DID shop for ===================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'title-insurance', 'base_fee',
     $${"feeCode":"title-insurance","tridBucket":"C","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":"purchase:1150, refi:650"}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Title insurance (purchase 1150 / refi 650)",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "1150", "o3": "'title-insurance'", "o4": "'C'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "650",  "o3": "'title-insurance'", "o4": "'C'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "650",  "o3": "'title-insurance'", "o4": "'C'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'survey', 'base_fee',
     $${"feeCode":"survey","tridBucket":"C","when":{"loan.purpose":{"eq":"purchase"}},"amount":400}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Survey fee (purchase only)",
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
              {"_id": "r1", "i1": "'purchase'", "o1": "true", "o2": "400", "o3": "'survey'", "o4": "'C'"},
              {"_id": "r2",               "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ================= E — Taxes and other government fees ======================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'recording-fee', 'base_fee',
     $${"feeCode":"recording-fee","tridBucket":"E","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":125}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Recording fee",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "125", "o3": "'recording-fee'", "o4": "'E'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "125", "o3": "'recording-fee'", "o4": "'E'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "125", "o3": "'recording-fee'", "o4": "'E'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'transfer-tax', 'base_fee',
     $${"feeCode":"transfer-tax","tridBucket":"E","when":{"loan.purpose":{"eq":"purchase"}},"amount":"loan.amount * 0.001"}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Transfer tax (0.1% of amount, purchase only)",
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
              {"_id": "r1", "i1": "'purchase'", "o1": "true", "o2": "loan.amount * 0.001", "o3": "'transfer-tax'", "o4": "'E'"},
              {"_id": "r2",               "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ==================== F — Prepaids =========================================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'prepaid-interest', 'base_fee',
     $${"feeCode":"prepaid-interest","tridBucket":"F","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":"loan.amount * 0.065 / 365 * 15"}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Prepaid interest (15 days @ 6.5%)",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "loan.amount * 0.065 / 365 * 15", "o3": "'prepaid-interest'", "o4": "'F'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "loan.amount * 0.065 / 365 * 15", "o3": "'prepaid-interest'", "o4": "'F'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "loan.amount * 0.065 / 365 * 15", "o3": "'prepaid-interest'", "o4": "'F'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ============== G — Initial escrow payment at closing =======================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'escrow-deposit', 'base_fee',
     $${"feeCode":"escrow-deposit","tridBucket":"G","when":{"loan.purpose":{"in":["purchase","rateTermRefi","cashOutRefi"]}},"amount":2400}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Initial escrow deposit (12-mo impounds)",
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
              {"_id": "r1", "i1": "'purchase'",    "o1": "true", "o2": "2400", "o3": "'escrow-deposit'", "o4": "'G'"},
              {"_id": "r2", "i1": "'rateTermRefi'", "o1": "true", "o2": "2400", "o3": "'escrow-deposit'", "o4": "'G'"},
              {"_id": "r3", "i1": "'cashOutRefi'",  "o1": "true", "o2": "2400", "o3": "'escrow-deposit'", "o4": "'G'"},
              {"_id": "r4",                        "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$),

    -- ====================== H — Other ===========================================
    ('aa5ce000-0000-4000-8000-0000000000ac'::uuid, 'pest-inspection', 'base_fee',
     $${"feeCode":"pest-inspection","tridBucket":"H","when":{"loan.purpose":{"eq":"purchase"}},"amount":95}$$,
     $${
       "nodes": [
         {"id": "in",  "type": "inputNode", "name": "Loan scenario", "position": {"x": 0, "y": 0}},
         {"id": "tbl", "type": "decisionTableNode", "name": "Pest inspection (purchase only)",
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
              {"_id": "r1", "i1": "'purchase'", "o1": "true", "o2": "95", "o3": "'pest-inspection'", "o4": "'H'"},
              {"_id": "r2",               "o1": "false"}
            ]
          }},
         {"id": "out", "type": "outputNode", "name": "Base fee", "position": {"x": 560, "y": 0}}
       ],
       "edges": [
         {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
         {"id": "e2", "sourceId": "tbl", "targetId": "out"}
       ]
     }$$)
) AS v(tenant_id, key, kind, spec, jdm);

-- ---------------------------------------------------------------------------
-- Insert published rows into every env schema. published_at steps one week
-- per promotion stage starting 2026-01-12 so the fixtures read like a
-- completed DEV→PROD chain that post-dates the 002 origination pair.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    env    TEXT;
    step   INT := 0;
    pub_ts TIMESTAMPTZ;
    t      UUID;
BEGIN
    FOR env IN SELECT unnest(ARRAY['zara_dev','zara_qa','zara_uat','zara_prod']) LOOP
        pub_ts := TIMESTAMPTZ '2026-01-12 00:00:00+00' + (step || ' weeks')::interval;
        step := step + 1;
        EXECUTE format('SET search_path = %I', env);
        FOR t IN SELECT DISTINCT tenant_id FROM trid_seed LOOP
            PERFORM set_config('zara.tenant_id', t::text, false);
            EXECUTE format(
                'INSERT INTO %I.rule_artifacts
                     (tenant_id, key, kind, status, spec, jdm, sha256, created_by, published_at)
                 SELECT tenant_id, key, kind, ''published'', spec::jsonb, jdm::jsonb,
                        encode(sha256(convert_to(jdm::jsonb::text, ''UTF8'')), ''hex''),
                        ''seed'', %L
                 FROM trid_seed WHERE tenant_id = %L
                 ON CONFLICT (tenant_id, key, published_at) WHERE status = ''published''
                 DO NOTHING', env, pub_ts, t);
        END LOOP;
    END LOOP;
END
$$;

DROP TABLE trid_seed;
