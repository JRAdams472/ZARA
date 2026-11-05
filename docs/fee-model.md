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

## Demo matrix (`seed/005_demo_trid_fees.sql`)

The Acme tenant ships a realistic closing-cost lineup so
`POST /api/evaluate/{env}` returns a TRID-categorized payload an
integration consumer can render directly. All rows are published in every
environment (dev/qa/uat/prod) — no dev drafts.

| Key | Bucket | Charged when | Amount |
|---|---|---|---|
| `origination` | A | rateTermRefi / cashOutRefi | $900 flat |
| `underwriting` | A | any purpose | $795 flat |
| `processing` | A | any purpose | $450 flat |
| `discount-points` | A | `borrower.discountPoints == true` | `loan.amount × 0.0025` |
| `appraisal` | B | any purpose | $650 flat |
| `credit-report` | B | any purpose | $45 flat |
| `flood-cert` | B | any purpose | $15 flat |
| `title-insurance` | C | any purpose | purchase $1,150 / refi $650 |
| `survey` | C | purchase only | $400 flat |
| `recording-fee` | E | any purpose | $125 flat |
| `transfer-tax` | E | purchase only | `loan.amount × 0.001` |
| `prepaid-interest` | F | any purpose | `loan.amount × 0.065 ÷ 365 × 15` |
| `escrow-deposit` | G | any purpose | $2,400 flat |
| `pest-inspection` | H | purchase only | $95 flat |

Expression-priced rows emit a zen-expression in the decision-table amount
cell — output cells evaluate against the full scenario context, so
`loan.amount` resolves without being declared as a table input.

Contract notes for consumers:

- **Every published `base_fee` emits a line** — a fee whose rules don't
  charge still appears with `total: 0` and its `feeCode`/`tridBucket`.
  Filter on `total > 0` for the applicable set.
- **`origination-adj`** (adjustment_set, `appliesTo: origination`) adds
  veteran −$500 / high-balance +$250 / floor 0 on top of the origination
  base only — other fees carry no adjustments.
- Northstar keeps its own two-artifact matrix (`origination` $1,200 +
  `origination-adj`) as the tenant-isolation contrast fixture.

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
