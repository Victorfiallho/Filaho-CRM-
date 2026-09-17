import { describe, expect, it } from "vitest";
import {
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
    hasEnoughData: true,
    expectedProfitTarget: 1100,
    minimumAcceptableProfit: 800,
    minimumMarginPct: 35
  };

  it("is gray when there isn't enough data yet", () => {
    expect(evaluateProjectHealth({ ...base, hasEnoughData: false, forecastProfitValue: 0, forecastMarginPctValue: 0 }).status).toBe("gray");
  });

  it("is green when forecast profit meets or beats the target and margin is at/above policy", () => {
    expect(evaluateProjectHealth({ ...base, forecastProfitValue: 1100, forecastMarginPctValue: 40 }).status).toBe("green");
  });

  it("is yellow at $900 forecast profit (below target, above the $800 floor)", () => {
    expect(evaluateProjectHealth({ ...base, forecastProfitValue: 900, forecastMarginPctValue: 40 }).status).toBe("yellow");
  });

  it("is red below the $800 minimum acceptable profit", () => {
    expect(evaluateProjectHealth({ ...base, forecastProfitValue: 799, forecastMarginPctValue: 40 }).status).toBe("red");
  });

  it("is red on a margin breach even when the dollar floor is still met", () => {
    const result = evaluateProjectHealth({ ...base, forecastProfitValue: 1000, forecastMarginPctValue: 30 });
    expect(result.status).toBe("red");
    expect(result.alerts[0]).toMatch(/margin/i);
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
