//! Fee-eval unit tests — snapshots built from embedded JDM, no database.
//! Graphs mirror the seeded shape (docs/fee-model.md): a `first`-hit
//! base_fee table emitting charged/amount/feeCode/tridBucket and a
//! `collect` adjustment_set emitting {rule,op,value} rows.

use serde_json::json;
use zara_engine::eval::evaluate_fees;
use zara_engine::snapshot::{ArtifactKind, FeeMeta, Snapshot};
use zen_engine::loader::{CachedLoader, DynamicLoader, MemoryLoader};
use zen_engine::model::DecisionContent;

const BASE_FEE_JDM: &str = r#"{
  "nodes": [
    {"id": "in", "type": "inputNode", "name": "Request", "position": {"x": 0, "y": 0}},
    {"id": "tbl", "type": "decisionTableNode", "name": "Origination",
     "position": {"x": 280, "y": 0},
     "content": {
       "hitPolicy": "first",
       "inputs": [{"id": "i1", "name": "Purpose", "field": "loan.purpose"}],
       "outputs": [
         {"id": "o1", "name": "charged", "field": "charged"},
         {"id": "o2", "name": "amount", "field": "amount"},
         {"id": "o3", "name": "feeCode", "field": "feeCode"},
         {"id": "o4", "name": "tridBucket", "field": "tridBucket"}
       ],
       "rules": [
         {"_id": "r1", "i1": "'rateTermRefi'", "o1": "true", "o2": "900", "o3": "'origination'", "o4": "'A'"},
         {"_id": "r2", "i1": "'cashOutRefi'",  "o1": "true", "o2": "900", "o3": "'origination'", "o4": "'A'"},
         {"_id": "r3",                         "o1": "false"}
       ]
     }},
    {"id": "out", "type": "outputNode", "name": "Response", "position": {"x": 560, "y": 0}}
  ],
  "edges": [
    {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
    {"id": "e2", "sourceId": "tbl", "targetId": "out"}
  ]
}"#;

const ADJ_JDM: &str = r#"{
  "nodes": [
    {"id": "in", "type": "inputNode", "name": "Request", "position": {"x": 0, "y": 0}},
    {"id": "tbl", "type": "decisionTableNode", "name": "Adjustments",
     "position": {"x": 280, "y": 0},
     "content": {
       "hitPolicy": "collect",
       "inputs": [
         {"id": "i1", "name": "VA", "field": "borrower.vaEligible"},
         {"id": "i2", "name": "Amount", "field": "loan.amount"}
       ],
       "outputs": [
         {"id": "o1", "name": "rule", "field": "adjustments[].rule"},
         {"id": "o2", "name": "op", "field": "adjustments[].op"},
         {"id": "o3", "name": "value", "field": "adjustments[].value"}
       ],
       "rules": [
         {"_id": "r1", "i1": "true",     "o1": "'veteran-discount'",   "o2": "'add'",       "o3": "-500"},
         {"_id": "r2", "i2": "> 647200", "o1": "'high-balance'",       "o2": "'add'",       "o3": "250"},
         {"_id": "r3",                  "o1": "'non-negative-floor'", "o2": "'cap_floor'", "o3": "0"}
       ]
     }},
    {"id": "out", "type": "outputNode", "name": "Response", "position": {"x": 560, "y": 0}}
  ],
  "edges": [
    {"id": "e1", "sourceId": "in",  "targetId": "tbl"},
    {"id": "e2", "sourceId": "tbl", "targetId": "out"}
  ]
}"#;

fn snapshot(adj_kind: &str) -> Snapshot {
    let mem = MemoryLoader::default();
    for (key, jdm) in [("origination", BASE_FEE_JDM), ("origination-adj", ADJ_JDM)] {
        mem.add(
            key.to_string(),
            serde_json::from_value::<DecisionContent>(serde_json::from_str(jdm).unwrap()).unwrap(),
        );
    }
    Snapshot {
        fingerprint: "test".into(),
        loader: std::sync::Arc::new(CachedLoader::from(std::sync::Arc::new(mem) as DynamicLoader)),
        fees: vec![
            FeeMeta {
                key: "origination".into(),
                kind: ArtifactKind::BaseFee,
                applies_to: None,
            },
            FeeMeta {
                key: "origination-adj".into(),
                kind: match adj_kind {
                    "adjustment_set" => ArtifactKind::AdjustmentSet,
                    _ => ArtifactKind::BaseFee,
                },
                applies_to: Some("origination".into()),
            },
        ],
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn veteran_refi_net_400() {
    let scenario = json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
                          "borrower": {"vaEligible": true}});
    let report = evaluate_fees(&snapshot("adjustment_set"), &scenario)
        .await
        .unwrap();
    assert_eq!(report.fees.len(), 1);
    let fee = &report.fees[0];
    assert_eq!(fee.fee_code, "origination");
    assert_eq!(fee.trid_bucket.as_deref(), Some("A"));
    assert_eq!(fee.base, 900.0);
    assert_eq!(fee.total, 400.0); // 900 − 500, floor untouched
    assert_eq!(fee.adjustments.len(), 2); // veteran + floor (no high-balance)
    assert_eq!(report.total, 400.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn non_veteran_pays_full() {
    let scenario = json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
                          "borrower": {}});
    let report = evaluate_fees(&snapshot("adjustment_set"), &scenario)
        .await
        .unwrap();
    assert_eq!(report.fees[0].total, 900.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn high_balance_adds_250() {
    let scenario = json!({"loan": {"purpose": "cashOutRefi", "amount": 700000},
                          "borrower": {}});
    let report = evaluate_fees(&snapshot("adjustment_set"), &scenario)
        .await
        .unwrap();
    assert_eq!(report.fees[0].total, 1150.0); // 900 + 250
}

#[tokio::test(flavor = "multi_thread")]
async fn purchase_charges_nothing() {
    let scenario = json!({"loan": {"purpose": "purchase", "amount": 500000},
                          "borrower": {"vaEligible": true}});
    let report = evaluate_fees(&snapshot("adjustment_set"), &scenario)
        .await
        .unwrap();
    // Base rule not charged → the line exists but contributes 0.
    assert_eq!(report.fees[0].base, 0.0);
    assert_eq!(report.fees[0].total, 0.0);
    assert_eq!(report.total, 0.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn eval_is_idempotent() {
    let scenario = json!({"loan": {"purpose": "rateTermRefi", "amount": 500000},
                          "borrower": {"vaEligible": true}});
    let snap = snapshot("adjustment_set");
    let a = evaluate_fees(&snap, &scenario).await.unwrap();
    let b = evaluate_fees(&snap, &scenario).await.unwrap();
    assert_eq!(
        serde_json::to_value(a.fees[0].total).unwrap(),
        serde_json::to_value(b.fees[0].total).unwrap()
    );
}
