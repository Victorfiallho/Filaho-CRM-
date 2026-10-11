import { describe, expect, it } from "vitest";
import { findJobForLead, jobDraftFromLead } from "./leadConversion";
import type { Job, Lead } from "./types";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead_1", company_id: "wish_cabinets", customer_id: "cust_1", name: "Jane Doe",
    phone: "", email: "", address: "", city: "", state: "", zip: "", stage_id: "won",
    service_type: "Kitchen Cabinets", value: 18500, source: "Meta Ads",
    lat: null, lng: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    ...overrides
  };
}

describe("jobDraftFromLead", () => {
  it("carries client, value, service and the lead link over", () => {
    const draft = jobDraftFromLead(lead());
    expect(draft).toEqual({
      title: "Kitchen Cabinets — Jane Doe",
      customer_id: "cust_1",
      lead_id: "lead_1",
      service_type: "Kitchen Cabinets",
      estimated_value: 18500,
      status: "planned"
    });
  });

  it("falls back to the name alone when the lead has no service", () => {
    expect(jobDraftFromLead(lead({ service_type: "" })).title).toBe("Jane Doe");
  });

  it("handles a lead with no linked client or value", () => {
    const draft = jobDraftFromLead(lead({ customer_id: null, value: 0, name: " " }));
    expect(draft.customer_id).toBe("");
    expect(draft.estimated_value).toBe(0);
    expect(draft.title).toBe("Kitchen Cabinets — New client");
  });
});

describe("findJobForLead", () => {
  it("finds the job created from a lead, ignoring unrelated jobs", () => {
    const jobs = [{ id: "job_a", lead_id: null }, { id: "job_b", lead_id: "lead_1" }] as Job[];
    expect(findJobForLead("lead_1", jobs)?.id).toBe("job_b");
    expect(findJobForLead("lead_2", jobs)).toBeUndefined();
  });
});
