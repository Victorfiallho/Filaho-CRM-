import { describe, expect, it } from "vitest";
import { findClient, intakeStage, leadIsUsable, matchService, parseLeadPayload } from "./leadIntake.js";

const params = obj => new URLSearchParams(obj);

describe("parseLeadPayload", () => {
  it("reads Meta Lead Ads field names", () => {
    const lead = parseLeadPayload(params({
      full_name: "Jane Doe", phone_number: "+1 (512) 555-0134", email: "Jane@Example.com", zip_code: "78701-1234",
      campaign_id: "120211", campaign_name: "Kitchen Fall"
    }));
    expect(lead).toMatchObject({
      name: "Jane Doe", phone_e164: "+15125550134", email: "jane@example.com", zip: "78701",
      campaign_id: "120211", campaign_name: "Kitchen Fall", source: "Meta Ads"
    });
  });

  it("joins first and last name and accepts mixed-case keys", () => {
    expect(parseLeadPayload(params({ "First Name": "Ana", "Last Name": "Silva", Phone: "5125550134" })).name).toBe("Ana Silva");
  });

  it("turns unknown form answers into notes and drops Meta plumbing ids", () => {
    const lead = parseLeadPayload(params({
      full_name: "Jane", email: "j@x.com", "what_is_your_budget?": "$10k-20k", ad_id: "999", form_id: "123"
    }));
    expect(lead.notes).toBe("what is your budget: $10k-20k");
  });

  it("falls back to the email for the name", () => {
    expect(parseLeadPayload(params({ email: "bob@x.com" })).name).toBe("bob");
  });
});

describe("leadIsUsable", () => {
  it("needs a name plus a valid phone or email", () => {
    expect(leadIsUsable(parseLeadPayload(params({ name: "Jane", phone: "123" })))).toBe(false);
    expect(leadIsUsable(parseLeadPayload(params({ name: "Jane", phone: "5125550134" })))).toBe(true);
    expect(leadIsUsable(parseLeadPayload(params({ email: "jane@x.com" })))).toBe(true);
  });
});

describe("findClient", () => {
  const clients = [
    { id: "a", phone: "(512) 555-0134", email: "" },
    { id: "b", phone: "", email: "Mary@x.com" }
  ];
  it("matches by phone digits or email", () => {
    expect(findClient(clients, { phone_e164: "+15125550134", email: "" })?.id).toBe("a");
    expect(findClient(clients, { phone_e164: null, email: "mary@x.com" })?.id).toBe("b");
    expect(findClient(clients, { phone_e164: "+15125550199", email: "z@x.com" })).toBeNull();
  });
});

describe("matchService", () => {
  const services = ["Kitchen Cabinets", "Bathroom Vanity"];
  it("returns the company's own name for a match, else empty", () => {
    expect(matchService("kitchen cabinets", services)).toBe("Kitchen Cabinets");
    expect(matchService("New kitchen cabinets please", services)).toBe("Kitchen Cabinets");
    expect(matchService("Roofing", services)).toBe("");
    expect(matchService("", services)).toBe("");
  });
});

describe("intakeStage", () => {
  it("prefers 'new', else the first open stage", () => {
    expect(intakeStage([{ id: "contacted", order: 2, type: "open" }, { id: "new", order: 1, type: "open" }])).toBe("new");
    expect(intakeStage([{ id: "won", order: 1, type: "won" }, { id: "lead_in", order: 2, type: "open" }])).toBe("lead_in");
    expect(intakeStage([])).toBe("new");
  });
});
