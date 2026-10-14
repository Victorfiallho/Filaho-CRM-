import { describe, expect, it } from "vitest";
import { createContext, findClients, findJobs, findLeads, getOverview, getRecord, getToday, localDay } from "./assistantTools.js";

const TODAY = "2026-10-14";
const data = {
  stages: [{ id: "new", name: "New", type: "open" }, { id: "quote", name: "Quote sent", type: "open" }, { id: "won", name: "Won", type: "won" }, { id: "lost", name: "Lost", type: "lost" }],
  users: [{ id: "u1", name: "Victor" }],
  customers: [
    { id: "c1", name: "Bob Lee", phone: "(404) 555-0123", city: "Roswell", status: "active", created_at: "2026-09-01T12:00:00Z" },
    { id: "c2", name: "Ana Souza", phone: "", city: "Marietta", status: "active", created_at: "2026-10-01T12:00:00Z" }
  ],
  leads: [
    { id: "l1", customer_id: "c1", name: "Bob Lee", title: "Kitchen", stage_id: "won", value: 9800, service_type: "Kitchen Cabinets", created_at: "2026-09-02T12:00:00Z", updated_at: "2026-09-20T12:00:00Z" },
    { id: "l2", customer_id: "c1", name: "Bob Lee", title: "Master bathroom", stage_id: "quote", value: 6400, service_type: "Bathroom Vanities", next_action: "Call back", next_action_date: "2026-10-10", owner_user_id: "u1", created_at: "2026-10-12T12:00:00Z", updated_at: "2026-10-12T12:00:00Z" },
    { id: "l3", customer_id: "c2", name: "Ana Souza", stage_id: "new", value: 4200, service_type: "Kitchen Cabinets", next_action_date: TODAY, created_at: "2026-10-14T15:00:00Z", updated_at: "2026-10-14T15:00:00Z" },
    { id: "l4", customer_id: "c2", name: "Ana Souza", stage_id: "lost", value: 1000, service_type: "Refacing", created_at: "2026-08-01T12:00:00Z", updated_at: "2026-08-02T12:00:00Z" }
  ],
  jobs: [
    { id: "j1", customer_id: "c1", lead_id: "l1", title: "Kitchen · Bob Lee", status: "scheduled", scheduled_date: TODAY, estimated_value: 9800, created_at: "2026-09-20T12:00:00Z" },
    { id: "j2", customer_id: "c2", title: "Vanity", status: "planned", scheduled_date: "2026-10-18", estimated_value: 1500, created_at: "2026-10-01T12:00:00Z" },
    { id: "j3", customer_id: null, customer_name: "Walk-in", title: "Old job", status: "complete", scheduled_date: "2026-09-01", estimated_value: 700, created_at: "2026-08-01T12:00:00Z" }
  ],
  services: ["Kitchen Cabinets", "Bathroom Vanities"]
};
const ctx = createContext(data, TODAY);

describe("findClients", () => {
  it("answers 'which clients have more than one deal', with their deals", () => {
    const r = findClients(ctx, { min_deals: 2 });
    expect(r.results.map(c => [c.name, c.deals_total, c.deals_open])).toEqual([["Bob Lee", 2, 1], ["Ana Souza", 2, 1]]);
    expect(r.results[0].deals.map(d => d.ref)).toEqual(["lead:l1", "lead:l2"]);
    expect(findClients(ctx, { min_open_deals: 2 }).total).toBe(0);
  });
});

describe("findLeads", () => {
  it("filters by stage name, status and text (title, phone)", () => {
    expect(findLeads(ctx, { stage: "Quote sent" }).results.map(l => l.ref)).toEqual(["lead:l2"]);
    expect(findLeads(ctx, { status: "open" }).total).toBe(2);
    expect(findLeads(ctx, { text: "bathroom" }).results[0]).toMatchObject({ deal_title: "Master bathroom", stage: "Quote sent", owner: "Victor", client: { ref: "client:c1", name: "Bob Lee" } });
  });

  it("finds overdue and today's follow-ups, and today's new deals", () => {
    expect(findLeads(ctx, { next_step: "overdue" }).results.map(l => l.ref)).toEqual(["lead:l2"]);
    expect(findLeads(ctx, { next_step: "today" }).results.map(l => l.ref)).toEqual(["lead:l3"]);
    expect(findLeads(ctx, { created_from: TODAY }).results.map(l => l.ref)).toEqual(["lead:l3"]);
  });

  it("sorts by value and reports the total value", () => {
    const r = findLeads(ctx, { sort: "value", limit: 2 });
    expect(r.results.map(l => l.value)).toEqual([9800, 6400]);
    expect(r).toMatchObject({ total: 4, shown: 2, total_value: 21400 });
  });
});

describe("findJobs", () => {
  it("lists upcoming jobs by date and keeps client names without a record", () => {
    expect(findJobs(ctx, { upcoming: true }).results.map(j => j.ref)).toEqual(["job:j1", "job:j2"]);
    expect(findJobs(ctx, { text: "walk" }).results[0].client).toEqual({ ref: null, name: "Walk-in" });
  });
});

describe("getToday", () => {
  it("gathers the day: jobs, follow-ups, new deals", () => {
    const t = getToday(ctx);
    expect(t.jobs_today.map(j => j.ref)).toEqual(["job:j1"]);
    expect(t.jobs_next_7_days.map(j => j.ref)).toEqual(["job:j2"]);
    expect(t.follow_ups_today.map(l => l.ref)).toEqual(["lead:l3"]);
    expect(t.follow_ups_overdue.map(l => l.ref)).toEqual(["lead:l2"]);
    expect(t.new_leads_today.map(l => l.ref)).toEqual(["lead:l3"]);
    expect(t).toMatchObject({ open_deals: 2, open_pipeline_value: 10600, open_deals_without_next_step: 0 });
  });
});

describe("getOverview and getRecord", () => {
  it("counts deals by outcome and jobs by status", () => {
    expect(getOverview(ctx)).toMatchObject({ clients: 2, deals: { total: 4, open: 2, won: 1, lost: 1 }, won_value: 9800, jobs: { scheduled: 1, planned: 1, complete: 1 } });
  });

  it("returns a client with deals, jobs and notes, and refuses an unknown ref", () => {
    const r = getRecord(ctx, "client:c1", [{ created_at: "2026-10-12T12:00:00Z", user_id: "u1", body: "Wants white shaker" }]);
    expect(r.deals.map(d => d.ref)).toEqual(["lead:l1", "lead:l2"]);
    expect(r.jobs.map(j => j.ref)).toEqual(["job:j1"]);
    expect(r.notes).toEqual([{ date: "2026-10-12", by: "Victor", text: "Wants white shaker" }]);
    expect(getRecord(ctx, "lead:nope").error).toBeTruthy();
    expect(getRecord(ctx, "whatever").error).toBeTruthy();
  });
});

describe("localDay", () => {
  it("uses the business time zone, not UTC", () => {
    expect(localDay("2026-10-15T02:00:00Z")).toBe("2026-10-14"); // 10pm in Atlanta
  });
});
