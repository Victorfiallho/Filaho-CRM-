// Classification rules for the transaction ledger (spec section 6):
//   - labor and subcontractor payments on a project reduce its profit;
//   - an owner draw reduces company cash but is not a project cost;
//   - a transfer is neither revenue nor profit;
//   - a payment to an owner must be classified by the user as labor (a cost)
//     or a draw (equity), see OWNER_AMBIGUOUS_TYPES.
import type { TransactionType } from "./types";

// A transaction counts as money the customer paid toward the contract.
export const CUSTOMER_PAYMENT_TYPES: readonly TransactionType[] = [
  "customer_deposit", "progress_payment", "final_payment", "change_order_payment"
];

// Cash direction, for company cash balance (project profit is computed from
// cost_line_items).
export const INFLOW_TYPES: readonly TransactionType[] = [
  "customer_deposit", "progress_payment", "final_payment", "change_order_payment",
  "vendor_refund", "vendor_credit", "reimbursement", "other_income"
];

// Reduces a project's profit. owner_draw and transfer are excluded on
// purpose (spec).
export const PROJECT_COST_TYPES: readonly TransactionType[] = [
  "material_purchase", "labor_payment", "subcontractor_payment", "employee_payment",
  "owner_labor_payment", "processing_fee", "customer_refund", "other_expense"
];

// Types whose payee may be an owner. The UI asks which one it is as soon as
// a payee is typed: the wrong pick either hides a real cost or charges a
// personal draw to the project.
export const OWNER_AMBIGUOUS_TYPES: readonly TransactionType[] = ["owner_labor_payment", "owner_draw"];

export function isCustomerPayment(type: TransactionType): boolean {
  return CUSTOMER_PAYMENT_TYPES.includes(type);
}
