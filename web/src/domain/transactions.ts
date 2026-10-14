// Pure classification rules for the transaction ledger — no I/O. Encodes the
// distinctions the spec calls out explicitly (section 6):
//   - labor/subcontractor payments tied to a project reduce that project's
//     profit; owner labor needs an internal cost to measure true
//     profitability (tracked on cost_line_items, not duplicated here).
//   - owner draw/distribution reduces company cash but is NOT a project cost.
//   - a transfer is neither revenue nor profit.
//   - Pedro/Nathaly-style ambiguous payments must be explicitly classified
//     by the user as labor (a real cost) or a draw (equity, not a cost) —
//     see OWNER_AMBIGUOUS_TYPES and the inline prompt this drives in the UI.
import type { TransactionType } from "./types";

// A transaction counts as money the customer paid toward the contract.
export const CUSTOMER_PAYMENT_TYPES: readonly TransactionType[] = [
  "customer_deposit", "progress_payment", "final_payment", "change_order_payment"
];

// Real cash flow direction — for company cash-balance math, not project
// profit math (which stays on cost_line_items per Phase 1).
export const INFLOW_TYPES: readonly TransactionType[] = [
  "customer_deposit", "progress_payment", "final_payment", "change_order_payment",
  "vendor_refund", "vendor_credit", "reimbursement", "other_income"
];

// Reduces a PROJECT's profit when tied to a job_id. owner_draw and transfer
// are deliberately excluded — per spec, a draw is company cash leaving, not
// a project cost, and a transfer is neither revenue nor profit.
export const PROJECT_COST_TYPES: readonly TransactionType[] = [
  "material_purchase", "labor_payment", "subcontractor_payment", "employee_payment",
  "owner_labor_payment", "processing_fee", "customer_refund", "other_expense"
];

// Types where the payee could plausibly be an owner (Pedro/Nathaly-style
// ambiguity) — the UI shows a classification prompt whenever a payee name is
// entered on one of these two, since picking the wrong one either hides a
// real project cost or wrongly dents the project's profit for a personal draw.
export const OWNER_AMBIGUOUS_TYPES: readonly TransactionType[] = ["owner_labor_payment", "owner_draw"];

export function isCustomerPayment(type: TransactionType): boolean {
  return CUSTOMER_PAYMENT_TYPES.includes(type);
}
