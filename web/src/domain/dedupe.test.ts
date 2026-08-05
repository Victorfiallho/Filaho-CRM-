import { describe, expect, it } from "vitest";
import { findDuplicate, findDuplicateJob, mergeClientData } from "./dedupe";
import type { Customer, Job } from "./types";

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1", company_id: "peach_fresh", name: "Jane Doe", phone: "5551234567",
    email: "jane@example.com", address: "123 Main St", city: "Atlanta", state: "GA", zip: "30303",
    status: "active", service_type: "Deep Cleaning", source: "Manual", notes: "", drive_folder_url: "",
    lat: "", lng: "", created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1", company_id: "peach_fresh", customer_id: "cust_1", lead_id: null, title: "Deep clean",
    status: "planned", service_type: "Deep Cleaning", scheduled_date: "2024-02-01", address: "123 Main St",
    city: "Atlanta", state: "GA", zip: "30303", estimated_value: 200, drive_folder_url: "",
    source_uid: "", lat: "", lng: "", created_at: "2024-01-01T00:00:00.000Z", updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("findDuplicate", () => {
  it("matches on phone", () => {
    const existing = [customer()];
    const result = findDuplicate({ phone: "(555) 123-4567" }, existing);
    expect(result?.reasons).toEqual(["phone"]);
  });

  it("matches on email", () => {
    const existing = [customer()];
    const result = findDuplicate({ email: "JANE@EXAMPLE.COM" }, existing);
    expect(result?.reasons).toEqual(["email"]);
  });

  it("matches on address", () => {
    const existing = [customer()];
    const result = findDuplicate({ address: "123 main st." }, existing);
    expect(result?.reasons).toEqual(["address"]);
  });

  it("matches on name + zip combined", () => {
    const existing = [customer()];
    const result = findDuplicate({ name: "jane doe", zip: "30303" }, existing);
    expect(result?.reasons).toEqual(["name + ZIP"]);
  });

  it("can match on multiple reasons at once", () => {
    const existing = [customer()];
    const result = findDuplicate({ phone: "5551234567", email: "jane@example.com" }, existing);
    expect(result?.reasons).toEqual(["phone", "email"]);
  });

  it("returns null when nothing matches", () => {
    const existing = [customer()];
    const result = findDuplicate({ phone: "9998887777", email: "nobody@nowhere.com" }, existing);
    expect(result).toBeNull();
  });

  it("does not match against records from a different pre-filtered list", () => {
    // Simulates the caller already having scoped `existing` to one company —
    // dedupe itself has no company concept, it just scans whatever list it's given.
    const result = findDuplicate({ phone: "5551234567" }, []);
    expect(result).toBeNull();
  });
});

describe("findDuplicateJob", () => {
  it("matches on calendar UID", () => {
    const existing = [job({ source_uid: "evt-123" })];
    const result = findDuplicateJob({ source_uid: "evt-123" }, existing);
    expect(result?.reasons).toEqual(["calendar UID"]);
  });

  it("matches on title + date", () => {
    const existing = [job()];
    const result = findDuplicateJob({ title: "Deep Clean", scheduled_date: "2024-02-01" }, existing);
    expect(result?.reasons).toEqual(["title + date"]);
  });

  it("matches on address + date", () => {
    const existing = [job()];
    const result = findDuplicateJob({ address: "123 Main St.", scheduled_date: "2024-02-01" }, existing);
    expect(result?.reasons).toEqual(["address + date"]);
  });

  it("returns null when the date differs", () => {
    const existing = [job()];
    const result = findDuplicateJob({ title: "Deep Clean", scheduled_date: "2024-03-01" }, existing);
    expect(result).toBeNull();
  });
});

describe("mergeClientData", () => {
  it("fills blank patch fields from the existing record", () => {
    const existing = customer({ phone: "5551234567", notes: "VIP client" });
    const patch = { name: "Jane Doe", phone: "", notes: "" } as Partial<Customer>;
    const merged = mergeClientData(existing, patch);
    expect(merged.phone).toBe("5551234567");
    expect(merged.notes).toBe("VIP client");
  });

  it("prefers non-blank patch values over existing ones", () => {
    const existing = customer({ phone: "5551234567" });
    const patch = { phone: "9998887777" } as Partial<Customer>;
    const merged = mergeClientData(existing, patch);
    expect(merged.phone).toBe("9998887777");
  });

  it("falls back to existing status/source, defaulting to active/Lead", () => {
    const existing = customer({ status: "past", source: "Referral" });
    const merged = mergeClientData(existing, {});
    expect(merged.status).toBe("past");
    expect(merged.source).toBe("Referral");

    const merged2 = mergeClientData(customer({ status: "", source: "" } as any), {});
    expect(merged2.status).toBe("active");
    expect(merged2.source).toBe("Lead");
  });
});
