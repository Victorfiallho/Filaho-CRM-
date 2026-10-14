import { describe, expect, it } from "vitest";
import {
  computeProjectFinancials,
  contractNote,
  contractRevenue,
  evaluateProjectHealth,
  maxAllowedCost,
  minimumProfitForMargin,
  requiredSellingPrice,
  safeToWithdraw,
  sumActualNetCost,
  sumCommittedUnpaid,
  sumEstimatedCost,
  sumRemainingEstimate
} from "./costing";
import type { CostLineItem } from "./types";

function lineItem(overrides: Partial<CostLineItem>): CostLineItem {
  return {
    id: "cli_test",
    company_id: "wish_cabinets",
    job_id: "job_test",
    category: "materials",
    description: "",
    vendor_id: null,
    estimated_cost: 0,
    quoted_to_customer: 0,
    committed_amount: 0,
    actual_paid: 0,
    internal_cost: 0,
    tax: 0,
    freight: 0,
    discount: 0,
    returned_amount: 0,
    net_cost: 0,
    expected_date: null,
    purchase_date: null,
    payment_method: "",
    status: "planned",
    responsible_user_id: null,
    receipt_id: null,
    notes: "",
    created_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides
  };
}

describe("margin math (35% margin, not markup)", () => {
  it("$7,350 contract at 35% margin -> $2,572.50 minimum profit and $4,777.50 max cost, per the spec's worked example", () => {
    expect(minimumProfitForMargin(7350, 35)).toBeCloseTo(2572.5, 2);
    expect(maxAllowedCost(7350, 35)).toBeCloseTo(4777.5, 2);
  });

  it("requiredSellingPrice divides by (1 - margin), not multiplies by (1 + margin)", () => {
    // $4,777.50 cost at a required 35% margin must reproduce the $7,350 contract.
    expect(requiredSellingPrice(4777.5, 35)).toBeCloseTo(7350, 2);
    // Sanity check that this is NOT the markup formula (cost * 1.35 = 6449.625).
    expect(requiredSellingPrice(4777.5, 35)).not.toBeCloseTo(4777.5 * 1.35, 2);
  });
});

describe("contractRevenue", () => {
  it("adds approved change orders and customer fees, subtracts discounts", () => {
    expect(contractRevenue(7000, 500, 100, 250)).toBe(7350);
  });
});

describe("Sara - Kitchen worked example", () => {
  // Contract $7,350. Installation charged $450, actual cost $380 (favorable
  // $70 variance). Plumbing charged $500, executed by the owner (internal
  // cost only, no real cash out).
  const items: CostLineItem[] = [
    lineItem({ id: "install", category: "subcontractor_labor", estimated_cost: 450, actual_paid: 380, status: "paid", net_cost: 380 }),
    lineItem({ id: "plumbing", category: "owner_labor", estimated_cost: 500, actual_paid: 0, internal_cost: 500, status: "paid", net_cost: 0 }),
    lineItem({ id: "materials", category: "materials", estimated_cost: 1130, committed_amount: 1130, status: "ordered" })
  ];

  it("shows a $70 favorable difference on installation (estimated vs. actual)", () => {
    const install = items.find(i => i.id === "install")!;
    expect(install.estimated_cost - install.net_cost).toBe(70);
  });

  it("counts the owner's plumbing labor as a real cost for margin purposes even with $0 actual_paid", () => {
    const plumbing = items.find(i => i.id === "plumbing")!;
    expect(plumbing.actual_paid).toBe(0);
    expect(sumActualNetCost([plumbing])).toBe(500); // internal_cost still counts
  });

  it("aggregates estimated, actual net, committed-unpaid and remaining-estimate correctly", () => {
    expect(sumEstimatedCost(items)).toBe(450 + 500 + 1130);
    expect(sumActualNetCost(items)).toBe(380 + 500 + 0);
    expect(sumCommittedUnpaid(items)).toBe(1130); // "ordered", nothing paid yet
    expect(sumRemainingEstimate(items)).toBe(0); // none are planned/quoted/approved
  });
});

describe("evaluateProjectHealth traffic light", () => {
  const base = {
    revenue: 10000,
    costItemCount: 3,
    expectedProfitTarget: 1100,
    minimumAcceptableProfit: 800,
    minimumMarginPct: 35
  };

  it("is gray with a reason when there is no contract value", () => {
    const result = evaluateProjectHealth({ ...base, revenue: 0, forecastProfitValue: 0, forecastMarginPctValue: 0 });
    expect(result.status).toBe("gray");
    expect(result.reason).toMatch(/contract value/i);
  });

  it("is gray — not green — when no cost items exist yet (100% margin on paper)", () => {
    const result = evaluateProjectHealth({ ...base, costItemCount: 0, forecastProfitValue: 10000, forecastMarginPctValue: 100 });
    expect(result.status).toBe("gray");
    expect(result.reason).toBe("Add cost estimates to calculate project health.");
  });

  it("is green when forecast profit meets or beats the target and margin is at/above policy, and says why", () => {
    const result = evaluateProjectHealth({ ...base, forecastProfitValue: 1100, forecastMarginPctValue: 40 });
    expect(result.status).toBe("green");
    expect(result.reason).toBe("Forecast margin 40.0% vs 35% minimum.");
  });

  it("is yellow at $900 forecast profit (below target, above the $800 floor)", () => {
    expect(evaluateProjectHealth({ ...base, forecastProfitValue: 900, forecastMarginPctValue: 40 }).status).toBe("yellow");
  });

  it("is red below the $800 minimum acceptable profit", () => {
    const result = evaluateProjectHealth({ ...base, forecastProfitValue: 799, forecastMarginPctValue: 40 });
    expect(result.status).toBe("red");
    expect(result.reason).toMatch(/below the \$800 minimum/);
  });

  it("is red on a margin breach even when the dollar floor is still met", () => {
    const result = evaluateProjectHealth({ ...base, forecastProfitValue: 1000, forecastMarginPctValue: 30 });
    expect(result.status).toBe("red");
    expect(result.alerts[0]).toMatch(/margin/i);
  });

  it("returns the same reason and alerts as message keys for translation", () => {
    const below = evaluateProjectHealth({ ...base, forecastProfitValue: 799, forecastMarginPctValue: 40 });
    expect(below.reasonParts.map(p => p.key)).toEqual(["pfh.belowMinimum", "pfh.marginLine"]);
    expect(below.reasonParts[0].vars).toEqual({ profit: "$799", minimum: "$800" });
    const breach = evaluateProjectHealth({ ...base, forecastProfitValue: 1000, forecastMarginPctValue: 30 });
    expect(breach.reasonParts.map(p => p.key)).toEqual(["pfh.marginLine"]);
    expect(breach.alertMessages).toEqual([{ key: "pfh.alertMargin", vars: { margin: "30.0%", min: 35 } }]);
    expect(evaluateProjectHealth({ ...base, revenue: 0, forecastProfitValue: 0, forecastMarginPctValue: 0 }).reasonParts).toEqual([{ key: "pfh.noContract" }]);
  });
});

describe("contractNote", () => {
  it("spells out the arithmetic behind the contract value", () => {
    expect(contractNote(1000, 10, 2, 0)).toBe("$1,000 − $10 discount + $2 fees");
    expect(contractNote(5000, 0, 0, 750)).toBe("$5,000 + $750 change orders");
    expect(contractNote(5000, 0, 0, 0)).toBe("Original contract, no adjustments");
  });
});

describe("computeProjectFinancials", () => {
  // The real job from the screenshot: $1,000 contract, $10 discount, $2 fees,
  // $1,000 received by hand, no cost items, no ledger payments.
  const laundryJob = {
    originalContractValue: 1000,
    discounts: 10,
    customerFees: 2,
    approvedChangeOrdersTotal: 0,
    minimumMarginPct: 35,
    contingencyPct: 10,
    minimumProfitUsd: null,
    paymentsReceivedManual: 1000,
    ledgerPaymentsReceived: null,
    releasedTotal: 0,
    items: [] as CostLineItem[]
  };

  it("never offers revenue as profit when no costs are entered (C1/C2)", () => {
    const summary = computeProjectFinancials(laundryJob);
    expect(summary.revenue).toBe(992);
    expect(summary.hasCostData).toBe(false);
    expect(summary.health.status).toBe("gray");
    expect(summary.safeToWithdraw).toBe(0);
    expect(summary.safeToWithdrawNotice).toBe("Estimate costs before releasing profit");
  });

  it("surfaces an overpayment as customer credit instead of a $0 balance (C3)", () => {
    const summary = computeProjectFinancials(laundryJob);
    expect(summary.balanceDue).toBe(0);
    expect(summary.customerCredit).toBe(8);
    const underpaid = computeProjectFinancials({ ...laundryJob, paymentsReceivedManual: 500 });
    expect(underpaid.balanceDue).toBe(492);
    expect(underpaid.customerCredit).toBe(0);
  });

  it("explains the contract value (C4)", () => {
    expect(computeProjectFinancials(laundryJob).contractNote).toBe("$1,000 − $10 discount + $2 fees");
  });

  it("prefers confirmed ledger payments over the manual field", () => {
    const summary = computeProjectFinancials({ ...laundryJob, ledgerPaymentsReceived: 600 });
    expect(summary.paymentsFromLedger).toBe(true);
    expect(summary.paymentsReceived).toBe(600);
  });

  it("releases only what is left after costs and reserves once costs exist", () => {
    const summary = computeProjectFinancials({
      ...laundryJob,
      originalContractValue: 10000, discounts: 0, customerFees: 0,
      paymentsReceivedManual: 6000,
      items: [
        lineItem({ estimated_cost: 3000, net_cost: 3000, status: "paid" }),
        lineItem({ estimated_cost: 1000, net_cost: 0, status: "planned" })
      ]
    });
    // 6000 received − 3000 paid − 1000 remaining − 400 contingency (10% of 4000)
    expect(summary.safeToWithdraw).toBe(1600);
    expect(summary.safeToWithdrawNotice).toBeNull();
    expect(summary.health.status).not.toBe("gray");
  });
});

describe("safeToWithdraw", () => {
  it("never goes negative — floors at 0 and lets the caller show a cash-shortage alert instead", () => {
    expect(safeToWithdraw(1000, 800, 500, 200, 100)).toBe(0); // raw = -600
  });

  it("returns the real remainder when there's genuinely spare cash", () => {
    expect(safeToWithdraw(5000, 1000, 500, 300, 200)).toBe(3000);
  });
});
