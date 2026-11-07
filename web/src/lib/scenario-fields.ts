/** Schema-picker row shape — mirrors jdm-editor's internal
 *  `SchemaSelectProps` (not exported by the package). */
export type FieldSchema = { field: string; name?: string; items?: FieldSchema[] };

/** Field catalog for the simple (business) decision-table editor — powers
 *  the guided input-column picker so business users choose known scenario
 *  fields instead of typing zen paths. Mirrors the eval request contract
 *  (`docs/fee-model.md`: loan/borrower/property attributes only, no PII);
 *  extension fields remain usable via the advanced editor. */
export const SCENARIO_FIELD_SCHEMA: FieldSchema[] = [
  { field: 'loan.purpose', name: 'Loan purpose' },
  { field: 'loan.amount', name: 'Loan amount' },
  { field: 'loan.termMonths', name: 'Term (months)' },
  { field: 'loan.rate', name: 'Note rate' },
  { field: 'loan.ltv', name: 'LTV' },
  { field: 'property.type', name: 'Property type' },
  { field: 'property.occupancy', name: 'Occupancy' },
  { field: 'property.state', name: 'Property state' },
  { field: 'property.appraisedValue', name: 'Appraised value' },
  { field: 'borrower.creditScore', name: 'Credit score' },
  { field: 'borrower.firstTimeBuyer', name: 'First-time buyer' },
  { field: 'borrower.vaEligible', name: 'VA eligible' },
  { field: 'borrower.firstResponder', name: 'First responder' },
  { field: 'borrower.discountPoints', name: 'Discount points' },
  { field: 'borrower.selfEmployed', name: 'Self-employed' },
];

/** Guided output-column picker — the fee-model output vocabulary
 *  (`docs/fee-model.md`): base_fee tables emit charged/amount/feeCode/
 *  tridBucket; adjustment_set rows emit op/value against `when` inputs. */
export const FEE_OUTPUT_SCHEMA: FieldSchema[] = [
  { field: 'charged', name: 'Charged' },
  { field: 'amount', name: 'Amount' },
  { field: 'feeCode', name: 'Fee code' },
  { field: 'tridBucket', name: 'TRID bucket' },
  { field: 'op', name: 'Adjustment op' },
  { field: 'value', name: 'Adjustment value' },
];
