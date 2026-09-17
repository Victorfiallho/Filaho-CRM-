import { describe, expect, it } from "vitest";
import { isCustomerPayment, isInflow, isProjectCost, OWNER_AMBIGUOUS_TYPES } from "./transactions";

describe("transaction classification", () => {
  it("counts customer-facing payment types as customer payments", () => {
    expect(isCustomerPayment("customer_deposit")).toBe(true);
    expect(isCustomerPayment("progress_payment")).toBe(true);
    expect(isCustomerPayment("final_payment")).toBe(true);
    expect(isCustomerPayment("change_order_payment")).toBe(true);
  });

  it("does not count an owner draw or a transfer as a customer payment", () => {
    expect(isCustomerPayment("owner_draw")).toBe(false);
    expect(isCustomerPayment("transfer")).toBe(false);
  });

  it("counts labor/subcontractor/owner-labor payments as project costs", () => {
    expect(isProjectCost("labor_payment")).toBe(true);
    expect(isProjectCost("subcontractor_payment")).toBe(true);
    expect(isProjectCost("owner_labor_payment")).toBe(true);
    expect(isProjectCost("material_purchase")).toBe(true);
  });

  it("an owner draw reduces company cash but is never a project cost, per spec", () => {
    expect(isProjectCost("owner_draw")).toBe(false);
  });

  it("a transfer is neither revenue nor a project cost, per spec", () => {
    expect(isCustomerPayment("transfer")).toBe(false);
    expect(isProjectCost("transfer")).toBe(false);
  });

  it("customer deposits are a cash inflow", () => {
    expect(isInflow("customer_deposit")).toBe(true);
    expect(isInflow("labor_payment")).toBe(false);
  });

  it("owner labor payment and owner draw are the two ambiguous 'Pedro/Nathaly' types that require explicit classification", () => {
    expect(OWNER_AMBIGUOUS_TYPES).toContain("owner_labor_payment");
    expect(OWNER_AMBIGUOUS_TYPES).toContain("owner_draw");
  });
});
