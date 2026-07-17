// Standardized reason codes required for every manual financial adjustment
// (contest reversals/voids, financial holds, forfeitures, etc.) — governance
// requirement: no financial adjustment may be submitted without one.
export const REASON_CODES = [
  { value: "settlement_correction", label: "Settlement Correction" },
  { value: "administrative_refund", label: "Administrative Refund" },
  { value: "contest_voided", label: "Contest Voided" },
  { value: "draw_correction", label: "Draw Correction" },
  { value: "chargeback_adjustment", label: "Chargeback Adjustment" },
  { value: "payment_reversal", label: "Payment Reversal" },
  { value: "fraud_investigation", label: "Fraud Investigation" },
  { value: "integrity_review_outcome", label: "Integrity Review Outcome" },
  { value: "cheating_determination", label: "Cheating Determination" },
  { value: "appeal_decision", label: "Appeal Decision" },
  { value: "technical_error", label: "Technical Error" },
  { value: "duplicate_transaction", label: "Duplicate Transaction" },
  { value: "compliance_review", label: "Compliance Review" },
  { value: "other", label: "Other (requires notes)" },
];

export const REASON_CODE_LABELS = Object.fromEntries(REASON_CODES.map((r) => [r.value, r.label]));