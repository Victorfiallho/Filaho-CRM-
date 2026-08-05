import { describe, expect, it } from "vitest";
import { cleanCustomer, cleanJob, leadFromCustomer } from "./records";
import type { Customer } from "./types";

describe("cleanCustomer", () => {
  it("fills in defaults for a mostly-empty record", () => {
    const result = cleanCustomer({}, "peach_fresh", "Deep Cleaning");
    expect(result.company_id).toBe("peach_fresh");
    expect(result.name).toBe("Unnamed client");
    expect(result.status).toBe("active");
    expect(result.service_type).toBe("Deep Cleaning");
    expect(result.source).toBe("Manual");
  });

  it("keeps provided values instead of defaults", () => {
    const result = cleanCustomer({ name: "Jane Doe", status: "past", service_type: "Recurring Cleaning", source: "Referral" }, "peach_fresh", "Deep Cleaning");
    expect(result.name).toBe("Jane Doe");
    expect(result.status).toBe("past");
    expect(result.service_type).toBe("Recurring Cleaning");
    expect(result.source).toBe("Referral");
  });

  it("coerces blank lat/lng to empty string rather than 0", () => {
    const result = cleanCustomer({}, "peach_fresh", "Deep Cleaning");
    expect(result.lat).toBe("");
    expect(result.lng).toBe("");
  });
});

describe("cleanJob", () => {
  it("falls back to the calendar-event title when there's no explicit title", () => {
    const result = cleanJob({ name: "Some event" }, "peach_fresh", "Deep Cleaning");
    expect(result.title).toBe("Some event");
  });

  it("defaults title, status, and service_type when nothing is provided", () => {
    const result = cleanJob({}, "peach_fresh", "Deep Cleaning");
    expect(result.title).toBe("Calendar event");
    expect(result.status).toBe("scheduled");
    expect(result.service_type).toBe("Deep Cleaning");
  });

  it("reads estimated_value from either estimated_value or value", () => {
    expect(cleanJob({ value: 250 }, "peach_fresh", "").estimated_value).toBe(250);
    expect(cleanJob({ estimated_value: 400, value: 250 }, "peach_fresh", "").estimated_value).toBe(400);
  });
});

describe("leadFromCustomer", () => {
  it("copies contact fields and starts the lead at stage 'new' with 0 value", () => {
    const customer: Customer = {
      id: "cust_1", company_id: "peach_fresh", name: "Jane Doe", phone: "5551234567", email: "jane@example.com",
      address: "123 Main St", city: "Atlanta", state: "GA", zip: "30303", status: "active",
      service_type: "Deep Cleaning", source: "Manual", notes: "", drive_folder_url: "", lat: "", lng: "",
      created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z"
    };
    const lead = leadFromCustomer(customer);
    expect(lead.company_id).toBe("peach_fresh");
    expect(lead.customer_id).toBe("cust_1");
    expect(lead.name).toBe("Jane Doe");
    expect(lead.stage_id).toBe("new");
    expect(lead.value).toBe(0);
    expect(lead.service_type).toBe("Deep Cleaning");
  });
});
