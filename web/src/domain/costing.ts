// Project Costing & Financial Control — pure formulas, no I/O. Every function
// here mirrors one formula from the "Project Costing & Financial Control"
// spec verbatim (section 2: FÓRMULAS FINANCEIRAS) so the spec's own worked
// examples can be asserted directly in costing.test.ts.
//
// Margin vs. markup: a 35% MARGIN means cost / (1 - 0.35) = cost / 0.65 sets
// the selling price — NOT cost * 1.35 (that would be a 35% markup, a smaller
// number). Every margin-based price/cost function below divides, never
// multiplies, for exactly this reason.
import type { CostLineItem } from "./types";

export const DEFAULT_MINIMUM_MARGIN_PCT = 35;
export const DEFAULT_DEPOSIT_PCT = 65;
export const DEFAULT_CONTINGENCY_PCT = 10;

export function contractRevenue(originalContractValue: number, approvedChangeOrders: number, customerFees: number, discounts: number): number {
  return originalContractValue + approvedChangeOrders + customerFees - discounts;
}

export function netMaterialCost(purchases: number, salesTax: number, freight: number, discounts: number, returns: number, vendorCredits: number): number {
  return purchases + salesTax + freight - discounts - returns - vendorCredits;
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

export function finalProfit(finalRevenue: number, finalNetCost: number): number {
  return finalRevenue - finalNetCost;
}

export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

export function budgetVariance(estimatedCost: number, forecastCost: number): number {
  return estimatedCost - forecastCost;
}

export function profitBuffer(forecastProfitValue: number, minimumAcceptableProfit: number): number {
  return forecastProfitValue - minimumAcceptableProfit;
}

// cost / (1 - margin) — dividing, not multiplying by (1 + margin). At 35%
// margin: $4,777.50 cost -> $4,777.50 / 0.65 = $7,350 selling price.
export function requiredSellingPrice(cost: number, requiredMarginPct: number): number {
  const fraction = requiredMarginPct / 100;
  if (fraction >= 1) return Infinity;
  return cost / (1 - fraction);
}

// The mirror of requiredSellingPrice: given a contract value and a required
// margin, how much can actually be spent. $7,350 at 35% margin -> $4,777.50.
export function maxAllowedCost(revenue: number, requiredMarginPct: number): number {
  return revenue * (1 - requiredMarginPct / 100);
}

// $7,350 at 35% -> $2,572.50, matching the spec's worked example exactly.
export function minimumProfitForMargin(revenue: number, requiredMarginPct: number): number {
  return revenue * (requiredMarginPct / 100);
}

export function minimumDepositRequired(costsBeforeNextPayment: number, initialCommitments: number, initialContingency: number): number {
  return costsBeforeNextPayment + initialCommitments + initialContingency;
}

// Never returns a negative "available" number — floors at 0, per spec
// ("Nunca mostrar valor negativo como disponível").
export function safeToWithdraw(cashReceived: number, costsPaid: number, committedUnpaidCosts: number, remainingRequiredCosts: number, contingencyReserve: number): number {
  const raw = cashReceived - costsPaid - committedUnpaidCosts - remainingRequiredCosts - contingencyReserve;
  return Math.max(0, raw);
}

// ── Cost line item aggregation helpers ───────────────────────────────────
// A "committed but unpaid" line is one whose status implies money is owed
// but actual_paid hasn't caught up yet (ordered/committed/partially_paid),
// as opposed to purely planned/quoted items that aren't real obligations.
const COMMITTED_STATUSES = new Set(["ordered", "committed", "partially_paid"]);

export function sumEstimatedCost(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.estimated_cost || 0), 0);
}

// For margin/profitability math: real cash out (net_cost) PLUS notional
// internal-only costs (owner labor with no cash impact) — this is "the true
// cost of the project", not "money that left the bank account".
export function sumActualNetCost(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.net_cost || 0) + Number(item.internal_cost || 0), 0);
}

// For cash-flow math (safeToWithdraw): real money paid out only — excludes
// internal_cost on purpose, since owner labor with $0 actual_paid never
// touched the bank account and must not count against cash reserves.
export function sumCashPaid(items: CostLineItem[]): number {
  return items.reduce((total, item) => total + Number(item.net_cost || 0), 0);
}

export interface CategoryBudgetUsage {
  category: string;
  estimated: number;
  actual: number;
  overBy: number;
}

// Per-category estimated-vs-actual, for the "This project is $X over the
// material budget" style alert — one row per category that has at least one
// line item, sorted worst-overrun-first.
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
  hasEnoughData: boolean;
  forecastProfitValue: number;
  expectedProfitTarget: number;
  minimumAcceptableProfit: number;
  forecastMarginPctValue: number;
  minimumMarginPct: number;
}

export interface ProjectHealthResult {
  status: HealthStatus;
  alerts: string[];
}

// Yellow when forecast profit dips below target but still clears the dollar
// floor; red when it falls below the floor OR the margin falls below policy
// (a margin breach is always red, even if the dollar floor is still met —
// per spec: "mesmo que o limite manual em dólares ainda esteja sendo atendido").
export function evaluateProjectHealth(input: ProjectHealthInput): ProjectHealthResult {
  if (!input.hasEnoughData) return { status: "gray", alerts: [] };

  const alerts: string[] = [];
  let status: HealthStatus = "green";

  if (input.forecastProfitValue < input.minimumAcceptableProfit) {
    status = "red";
  } else if (input.forecastProfitValue < input.expectedProfitTarget) {
    status = "yellow";
  }

  if (input.forecastMarginPctValue < input.minimumMarginPct) {
    status = "red";
    alerts.push(`This expense trend has reduced the forecast margin to ${input.forecastMarginPctValue.toFixed(1)}%, below the ${input.minimumMarginPct}% minimum policy.`);
  }

  return { status, alerts };
}
