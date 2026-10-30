//! Fee evaluation — the MPE-113 hot path.
//!
//! For each published `base_fee` artifact in the snapshot: evaluate its JDM
//! graph; `charged == true` fees then evaluate every `adjustment_set` whose
//! `spec.appliesTo` matches the artifact key, collecting `{rule, op, value}`
//! rows and applying them in order per docs/fee-model.md
//! (`add`/`set`/`percent`-of-base/`cap_floor`/`cap_ceiling`).
//!
//! zen `Variable` is `Rc`-based/`!Send`, so evaluation runs on a
//! `spawn_blocking` thread with its own current-thread runtime — no I/O,
//! no clock, no RNG inside; `Instant` is recorded on the async side only
//! (idempotent-eval invariant). A failed or malformed artifact records a
//! line-level error and contributes its base — one bad rule can never
//! break the whole report (MPEx adjustment-line semantics).

use serde::Serialize;
use serde_json::Value;
use zen_engine::{DecisionEngine, EvaluationSerializedOptions};

use crate::error::AppError;
use crate::snapshot::{ArtifactKind, Snapshot};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjustment {
    pub rule: String,
    pub op: String,
    pub value: f64,
    /// Running total after this op — the waterfall the UI renders.
    pub running_total: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeLine {
    pub artifact: String,
    pub fee_code: String,
    pub trid_bucket: Option<String>,
    pub base: f64,
    pub adjustments: Vec<Adjustment>,
    pub total: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalReport {
    pub fees: Vec<FeeLine>,
    pub total: f64,
    pub elapsed_ms: f64,
    pub fingerprint: String,
}

/// Evaluate every charged base fee in `snapshot` against `scenario`.
/// Pure function of (snapshot, scenario) — idempotent by construction.
pub async fn evaluate_fees(snapshot: &Snapshot, scenario: &Value) -> Result<EvalReport, AppError> {
    let started = std::time::Instant::now();
    let loader = snapshot.loader.clone();
    let fees = snapshot.fees.clone();
    let fingerprint = snapshot.fingerprint.clone();
    let scenario = scenario.clone();

    let mut report = tokio::task::spawn_blocking(move || -> Result<EvalReport, AppError> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| AppError::Internal(format!("eval runtime: {e}")))?;
        let engine = DecisionEngine::default().with_loader(loader);
        let opts = EvaluationSerializedOptions::default();

        let mut lines = Vec::new();
        for meta in fees.iter().filter(|m| m.kind == ArtifactKind::BaseFee) {
            lines.push(eval_base_fee(
                &rt,
                &engine,
                &fees,
                meta.key.as_str(),
                &scenario,
                opts,
            ));
        }
        Ok(EvalReport {
            total: lines.iter().map(|l| l.total).sum(),
            fees: lines,
            elapsed_ms: 0.0,
            fingerprint,
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("eval task failed: {e}")))??;

    report.elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok(report)
}

/// One base-fee artifact: evaluate, and if charged, apply its linked
/// adjustment sets in collect order.
fn eval_base_fee(
    rt: &tokio::runtime::Runtime,
    engine: &DecisionEngine,
    fees: &[crate::snapshot::FeeMeta],
    key: &str,
    scenario: &Value,
    opts: EvaluationSerializedOptions,
) -> FeeLine {
    let out = match rt.block_on(engine.evaluate_serialized(key, scenario.clone().into(), opts)) {
        Ok(out) => out,
        Err(e) => {
            return FeeLine {
                artifact: key.into(),
                fee_code: key.into(),
                trid_bucket: None,
                base: 0.0,
                adjustments: vec![],
                total: 0.0,
                error: Some(format!("{e}")),
            };
        }
    };
    let result = &out["result"];
    if result.get("charged").and_then(Value::as_bool) != Some(true) {
        return FeeLine {
            artifact: key.into(),
            fee_code: result
                .get("feeCode")
                .and_then(Value::as_str)
                .unwrap_or(key)
                .to_string(),
            trid_bucket: result
                .get("tridBucket")
                .and_then(Value::as_str)
                .map(str::to_string),
            base: 0.0,
            adjustments: vec![],
            total: 0.0,
            error: None,
        };
    }

    let base = result.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
    let mut total = base;
    let mut adjustments = Vec::new();

    for adj in fees
        .iter()
        .filter(|m| m.kind == ArtifactKind::AdjustmentSet && m.applies_to.as_deref() == Some(key))
    {
        let aout = match rt.block_on(engine.evaluate_serialized(
            adj.key.as_str(),
            scenario.clone().into(),
            opts,
        )) {
            Ok(o) => o,
            Err(e) => {
                adjustments.push(Adjustment {
                    rule: adj.key.clone(),
                    op: "error".into(),
                    value: 0.0,
                    running_total: total,
                    error: Some(format!("{e}")),
                });
                continue;
            }
        };
        // collect hit policy → `result` is an array of matched rows, each
        // carrying the grouped output object under its "adjustments[]" key.
        for row in aout["result"].as_array().cloned().unwrap_or_default() {
            let cell = row.get("adjustments[]").unwrap_or(&row);
            let rule = cell
                .get("rule")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string();
            let op = cell
                .get("op")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string();
            let value = cell.get("value").and_then(Value::as_f64).unwrap_or(0.0);
            let error = apply(&mut total, base, &op, value).err();
            adjustments.push(Adjustment {
                rule,
                op,
                value,
                running_total: total,
                error,
            });
        }
    }

    FeeLine {
        artifact: key.into(),
        fee_code: result
            .get("feeCode")
            .and_then(Value::as_str)
            .unwrap_or(key)
            .to_string(),
        trid_bucket: result
            .get("tridBucket")
            .and_then(Value::as_str)
            .map(str::to_string),
        base,
        adjustments,
        total,
        error: None,
    }
}

/// Ops per docs/fee-model.md. `percent` is of the BASE, not the running
/// total. Unknown ops are data defects — recorded on the line, not applied.
fn apply(total: &mut f64, base: f64, op: &str, value: f64) -> Result<(), String> {
    match op {
        "add" => *total += value,
        "set" => *total = value,
        "percent" => *total += base * value / 100.0,
        "cap_floor" => *total = total.max(value),
        "cap_ceiling" => *total = total.min(value),
        other => return Err(format!("unknown op {other:?}")),
    }
    Ok(())
}
