// Project costing: pure formulas, no I/O. Each mirrors a formula from the
// Project Costing & Financial Control spec (section 2), so the spec's worked
// examples are asserted directly in costing.test.ts.
//
// Margin, not markup: a 35% margin prices at cost / 0.65, not cost * 1.35
// (a 35% markup, a smaller number). Margin-based functions divide.
import type { CostLineItem } from "./types";

export const DEFAULT_MINIMUM_MARGIN_PCT = 35;
export const DEFAULT_DEPOSIT_PCT = 65;
export const DEFAULT_CONTINGENCY_PCT = 10;

export function contractRevenue(originalContractValue: number, approvedChangeOrders: number, customerFees: number, discounts: number): number {
  return originalContractValue + approvedChangeOrders + customerFees - discounts;
}

export function estimatedTotalCost(estimatedLineCosts: number[], contingency: number): number {
  return estimatedLineCosts.reduce((total, cost) => total + cost, 0) + contingency;
}

export function forecastFinalCost(actualCostsPaid: number, committedUnpaidCosts: number, remainingEstimatedCosts: number): number {
  return actualCostsPaid + committedUnpaidCosts + remainingEstimatedCosts;
}

export function expectedProfit(revenue: number, estimatedCost: number): number {
  return revenue - estimatedCost;
}

export function forecastProfit(revenue: number, forecastCost: number): number {
  return revenue - forecastCost;
}

export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

// cost / (1 - margin). At 35%: $4,777.50 / 0.65 = $7,350.
export function requiredSellingPrice(cost: number, requiredMarginPct: number): number {
  const fraction = requiredMarginPct / 100;
  if (fraction >= 1) return Infinity;
  return cost / (1 - fraction);
}

// The mirror of requiredSellingPrice: what can be spent on a contract at a
// required margin. $7,350 at 35% > $4,777.50.
export function maxAllowedCost(revenue: number, requiredMarginPct: number): number {
  return revenue * (1 - requiredMarginPct / 100);
}

// $7,350 at 35% > $2,572.50, the spec's worked example.
export function minimumProfitForMargin(revenue: number, requiredMarginPct: number): number {
  return revenue * (requiredMarginPct / 100);
}

// Floors at 0: never show a negative amount as available (spec).
export function safeToWithdraw(cashReceived: number, costsPaid: number, committedUnpaidCosts: number, remainingRequiredCosts: number, contingencyReserve: number): number {
  const raw = cashReceived - costsPaid - committedUnpaidCosts - remainingRequiredCosts - contingencyReserve;
  return Math.max(0, raw);
}

// ── Cost line item aggregation ──────────────────────────────────────────
// "Committed but unpaid": statuses that mean money is owed (ordered,
// committed, partially_paid) while actual_paid hasn't caught up. Planned and
// quoted items aren't obligations yet.
const COMMITTED_STATUSES = new Set(["ordered", "committed", "partially_paid"]);

export function sumEstimatedCost(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.estimated_cost || 0), 0);
}

// For margin math: cash out (net_cost) plus internal costs like owner labor.
// The true cost of the project, not what left the bank.
export function sumActualNetCost(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.net_cost || 0) + Number(item.internal_cost || 0), 0);
}

// For cash-flow math (safeToWithdraw): money actually paid out. Excludes
// internal_cost, since unpaid owner labor never touched the bank.
export function sumCashPaid(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.net_cost || 0), 0);
}

export interface CategoryBudgetUsage {
  category: string;
  estimated: number;
  actual: number;
  overBy: number;
}

// Estimated vs actual per category, for "$X over the materials budget"
// alerts. Categories with line items only, worst overrun first.
export function categoryBudgetUsage(items: CostLineItem[]): CategoryBudgetUsage[] {
  const byCategory = new Map<string, { estimated: number; actual: number }>();
  for (const item of items) {
    const entry = byCategory.get(item.category) || { estimated: 0, actual: 0 };
    entry.estimated += Number(item.estimated_cost || 0);
    entry.actual += Number(item.net_cost || 0) + Number(item.internal_cost || 0);
    byCategory.set(item.category, entry);
  }
  return [...byCategory.entries()]
    .map(([category, { estimated, actual }]) => ({ category, estimated, actual, overBy: actual - estimated }))
    .sort((a, b) => b.overBy - a.overBy);
}

export function sumCommittedUnpaid(items: CostLineItem[]): number {
  return items
    .filter(item => COMMITTED_STATUSES.has(item.status))
    .reduce((total, item) => total + Math.max(0, Number(item.committed_amount || 0) - Number(item.actual_paid || 0)), 0);
}

export function sumRemainingEstimate(items: CostLineItem[]): number {
  return items
    .filter(item => item.status === "planned" || item.status === "quoted" || item.status === "approved")
    .reduce((total, item) => total + Number(item.estimated_cost || 0), 0);
}

// ── Project health traffic light ─────────────────────────────────────────
export type HealthStatus = "green" | "yellow" | "red" | "gray";

export interface ProjectHealthInput {
  revenue: number;
  // Health needs cost estimates: with no cost items the forecast margin is
  // 100% and the light would go green on a project nobody has priced.
  costItemCount: number;
  forecastProfitValue: number;
  expectedProfitTarget: number;
  minimumAcceptableProfit: number;
  forecastMarginPctValue: number;
  minimumMarginPct: number;
}

// A message key plus its values, so the screen can show `reason`/`alerts`
// in the user's language. The English strings stay for tests and logs.
export interface CostingMessage {
  key: string;
  vars?: Record<string, string | number>;
}

export interface ProjectHealthResult {
  status: HealthStatus;
  // One sentence stating the rule behind the status, so the banner never
  // shows a bare "On track".
  reason: string;
  alerts: string[];
  reasonParts: CostingMessage[];
  alertMessages: CostingMessage[];
}

const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// Yellow when forecast profit is below target but above the dollar floor.
// Red when it's below the floor, or when the margin is below policy (always
// red, even if the dollar floor is met, per spec).
export function evaluateProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  if (input.revenue <= 0) {
    return { status: "gray", reason: "Set a contract value to calculate project health.", alerts: [], reasonParts: [{ key: "pfh.noContract" }], alertMessages: [] };
  }
  if (input.costItemCount === 0) {
    return { status: "gray", reason: "Add cost estimates to calculate project health.", alerts: [], reasonParts: [{ key: "pfh.noCosts" }], alertMessages: [] };
  }

  const marginLine = `Forecast margin ${fmtPct(input.forecastMarginPctValue)} vs ${input.minimumMarginPct}% minimum.`;
  const marginMsg: CostingMessage = { key: "pfh.marginLine", vars: { margin: fmtPct(input.forecastMarginPctValue), min: input.minimumMarginPct } };
  const alerts: string[] = [];
  const alertMessages: CostingMessage[] = [];
  let status: HealthStatus = "green";
  let reason = marginLine;
  let reasonParts = [marginMsg];

  if (input.forecastProfitValue < input.minimumAcceptableProfit) {
    status = "red";
    reason = `Forecast profit ${fmtUsd(input.forecastProfitValue)} is below the ${fmtUsd(input.minimumAcceptableProfit)} minimum. ${marginLine}`;
    reasonParts = [{ key: "pfh.belowMinimum", vars: { profit: fmtUsd(input.forecastProfitValue), minimum: fmtUsd(input.minimumAcceptableProfit) } }, marginMsg];
  } else if (input.forecastProfitValue < input.expectedProfitTarget) {
    status = "yellow";
    reason = `Forecast profit ${fmtUsd(input.forecastProfitValue)} is below the ${fmtUsd(input.expectedProfitTarget)} estimate. ${marginLine}`;
    reasonParts = [{ key: "pfh.belowTarget", vars: { profit: fmtUsd(input.forecastProfitValue), target: fmtUsd(input.expectedProfitTarget) } }, marginMsg];
  }

  if (input.forecastMarginPctValue < input.minimumMarginPct) {
    status = "red";
    reason = marginLine;
    reasonParts = [marginMsg];
    alerts.push(`This expense trend has reduced the forecast margin to ${fmtPct(input.forecastMarginPctValue)}, below the ${input.minimumMarginPct}% minimum policy.`);
    alertMessages.push({ key: "pfh.alertMargin", vars: { margin: fmtPct(input.forecastMarginPctValue), min: input.minimumMarginPct } });
  }

  return { status, reason, alerts, reasonParts, alertMessages };
}

// ── Whole-project summary ────────────────────────────────────────────────
// Every number the project screen (and each row of Company Financials)
// shows, computed in one place so both screens apply the same safety rules.

export interface ProjectFinancialsInput {
  originalContractValue: number;
  discounts: number;
  customerFees: number;
  approvedChangeOrdersTotal: number;
  minimumMarginPct: number;
  contingencyPct: number;
  minimumProfitUsd: number | null;
  paymentsReceivedManual: number;
  // Confirmed customer payments, or null when the ledger has none yet (then
  // the manual field is used).
  ledgerPaymentsReceived: number | null;
  releasedTotal: number;
  items: CostLineItem[];
}

export interface ProjectFinancialsSummary {
  revenue: number;
  contractNote: string;
  hasCostData: boolean;
  contingencyUsd: number;
  estimatedCost: number;
  actualNetCost: number;
  cashPaid: number;
  committedUnpaid: number;
  remainingEstimate: number;
  forecastCost: number;
  expectedProfit: number;
  expectedMarginPct: number;
  forecastProfit: number;
  forecastMarginPct: number;
  minimumProfit: number;
  remainingBudget: number;
  paymentsReceived: number;
  paymentsFromLedger: boolean;
  balanceDue: number;
  customerCredit: number;
  requiredReserve: number;
  releasedTotal: number;
  safeToWithdraw: number;
  safeToWithdrawNotice: string | null;
  health: ProjectHealthResult;
}

// "$1,000 − $10 discount + $2 fees": the arithmetic behind the contract
// value, so a number different from the original contract explains itself.
export function contractNote(original: number, discounts: number, fees: number, approvedChangeOrders: number): string {
  const parts = [fmtUsd(original)];
  if (discounts) parts.push(`− ${fmtUsd(discounts)} discount`);
  if (fees) parts.push(`+ ${fmtUsd(fees)} fees`);
  if (approvedChangeOrders) parts.push(`${approvedChangeOrders < 0 ? "−" : "+"} ${fmtUsd(Math.abs(approvedChangeOrders))} change orders`);
  return parts.length === 1 ? "Original contract, no adjustments" : parts.join(" ");
}

export const NO_COST_DATA_NOTICE = "Estimate costs before releasing profit";

export function computeProjectFinancials(input: ProjectFinancialsInput): ProjectFinancialsSummary {
  const { items } = input;
  const revenue = contractRevenue(input.originalContractValue, input.approvedChangeOrdersTotal, input.customerFees, input.discounts);
  const hasCostData = items.length > 0;

  const estimatedSum = sumEstimatedCost(items);
  const contingencyUsd = (estimatedSum * input.contingencyPct) / 100;
  const estCost = estimatedTotalCost(items.map(i => Number(i.estimated_cost || 0)), contingencyUsd);

  const actualNetCost = sumActualNetCost(items); // includes internal (owner labor) cost, for true margin
  const cashPaid = sumCashPaid(items); // real cash out only, for cash-flow math
  const committedUnpaid = sumCommittedUnpaid(items);
  const remainingEstimate = sumRemainingEstimate(items);
  const forecastCost = forecastFinalCost(actualNetCost, committedUnpaid, remainingEstimate);

  const expProfit = expectedProfit(revenue, estCost);
  const forecastProfitValue = forecastProfit(revenue, forecastCost);
  const minimumProfit = input.minimumProfitUsd ?? minimumProfitForMargin(revenue, input.minimumMarginPct);
  const forecastMarginPct = marginPct(forecastProfitValue, revenue);

  const paymentsFromLedger = input.ledgerPaymentsReceived !== null;
  const paymentsReceived = paymentsFromLedger ? Number(input.ledgerPaymentsReceived) : input.paymentsReceivedManual;
  // Signed difference, not a floor at zero: an overpayment is money owed
  // back to the customer and must show up, not vanish into "$0 due".
  const diff = paymentsReceived - revenue;
  const balanceDue = diff < 0 ? Math.abs(diff) : 0;
  const customerCredit = diff > 0 ? diff : 0;

  const requiredReserve = committedUnpaid + remainingEstimate + contingencyUsd;
  // Profit already released has left the account too, so it counts as paid
  // and can't be released twice. With no cost data, withdrawal is held at $0:
  // nothing has been reserved for costs not entered yet.
  const safe = hasCostData
    ? safeToWithdraw(paymentsReceived, cashPaid + input.releasedTotal, committedUnpaid, remainingEstimate, contingencyUsd)
    : 0;

  const health = evaluateProjectHealth({
    revenue,
    costItemCount: items.length,
    forecastProfitValue,
    expectedProfitTarget: expProfit,
    minimumAcceptableProfit: minimumProfit,
    forecastMarginPctValue: forecastMarginPct,
    minimumMarginPct: input.minimumMarginPct
  });
  if (hasCostData) {
    for (const cat of categoryBudgetUsage(items).filter(c => c.overBy > 0)) {
      health.alerts.push(`This project is ${fmtUsd(cat.overBy)} over the ${cat.category.replace(/_/g, " ")} budget.`);
      health.alertMessages.push({ key: "pfh.alertCategory", vars: { amount: fmtUsd(cat.overBy), category: cat.category } });
    }
    if (safe === 0 && requiredReserve > paymentsReceived - cashPaid) {
      health.alerts.push("There is not enough reserved cash to complete this project safely right now.");
      health.alertMessages.push({ key: "pfh.alertReserve" });
    }
  }

  return {
    revenue,
    contractNote: contractNote(input.originalContractValue, input.discounts, input.customerFees, input.approvedChangeOrdersTotal),
    hasCostData,
    contingencyUsd,
    estimatedCost: estCost,
    actualNetCost,
    cashPaid,
    committedUnpaid,
    remainingEstimate,
    forecastCost,
    expectedProfit: expProfit,
    expectedMarginPct: marginPct(expProfit, revenue),
    forecastProfit: forecastProfitValue,
    forecastMarginPct,
    minimumProfit,
    remainingBudget: Math.max(0, maxAllowedCost(revenue, input.minimumMarginPct) - forecastCost),
    paymentsReceived,
    paymentsFromLedger,
    balanceDue,
    customerCredit,
    requiredReserve,
    releasedTotal: input.releasedTotal,
    safeToWithdraw: safe,
    safeToWithdrawNotice: hasCostData ? null : NO_COST_DATA_NOTICE,
    health
  };
}
