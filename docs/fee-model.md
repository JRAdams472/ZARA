# Fee model

The fee model is the shape of every artifact Zara evaluates. It exists to
make missed charges structurally impossible: instead of N independent
rules each carrying their own fee amount (and each needing exactly-aligned
conditions), a fee is computed as **one base charge plus an ordered set of
alterations**.

```
final_fee = base_fee(scenario)  →  for each alteration rule, in order:
                                    if when(scenario): apply(op, value)
```

## Artifact kinds (`rule_artifacts.kind`)

| Kind | Decides | Example |
|---|---|---|
| `base_fee` | Whether the fee is charged at all, and the base amount | "$900 origination when `loan.purpose` is a refinance" |
| `adjustment_set` | Ordered alterations applied on top of the base | "veteran → −$500", "high-balance → +$250" |

`base_fee` and `adjustment_set` artifacts are plain JDM decision
graphs/tables — the alteration set evaluates each row's `when`
expression and applies its `{op, value}` cell in declared order.
An `adjustment_set` links to its base fee via `spec.appliesTo`, which
names the **`base_fee` artifact's `key`** (not its `feeCode`) — an
alteration can only target a base fee present in the same snapshot.

### Ops (`adjustment_set` rows)

| Op | Effect |
|---|---|
| `add` | `total += value` (negative value = discount) |
| `set` | `total = value` (full override of the running total) |
| `percent` | `total += base × value / 100` (of the BASE, not running) |
| `cap_floor` | `total = max(total, value)` |
| `cap_ceiling` | `total = min(total, value)` |

Order is significant and part of the artifact: business users see the
alterations as an ordered list in the editor.

## Worked example

```
base_fee "origination":  charged when loan.purpose in {rateTermRefi, cashOutRefi}
                         amount = 900
adjustment_set "origination-adj":
  1. when borrower.vaEligible            add −500   (veteran discount)
  2. when loan.amount > 647200           add +250   (high-balance)
  3. always                              cap_floor 0 (never negative)
```

A veteran refinancing sees `900 − 500 = 400`; a non-veteran purchase sees
no origination fee at all (base rule not charged).

## Input contract

The eval input is a **PII-free** loan scenario (same philosophy as MPEx's
loan model — loan/scenario attributes only, never names/SSNs/addresses).
Fields are optional; unknown extension fields pass through to rules.
Shape lands with the engine (Z2) — the eval boundary enforces the
PII denylist + value-shape guard (ADR-0005).

## Output contract

Per charged fee, the engine returns an itemized line:

```jsonc
{ "feeCode": "origination", "tridBucket": "A",
  "base": 900, "adjustments": [{"rule": "veteran-discount", "op": "add", "value": -500}],
  "total": 400 }
```

`tridBucket` is emitted per fee so downstream systems can render the
TRID-categorized closing-cost payload (MPE-113 §2).

## Drafts vs. published

`draft` rows are working copies — editable in place, unique per
(tenant, key). `published` rows are immutable snapshots (trigger-enforced):
promotion inserts a new published row carrying `sha256(graph)` into the
next environment; it never mutates the source. Historic rows stay
queryable per `(tenant_id, key, published_at)`.
