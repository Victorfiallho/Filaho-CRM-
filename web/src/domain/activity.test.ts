import { describe, expect, it } from "vitest";
import { describeActivity, isFinanceActivity, type ActivityContext } from "./activity";
import type { AuditLogEntry } from "./types";

const ctx: ActivityContext = {
  nameFor: (entity, id) => ({ "leads:lead_1": "Jane Doe", "jobs:job_1": "Kitchen Remodel" } as Record<string, string>)[`${entity}:${id}`],
  stageName: id => ({ won: "Won" } as Record<string, string>)[id],
  userName: id => ({ usr_1: "Victor" } as Record<string, string>)[id]
};

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return { id: "a1", company_id: "wish_cabinets", user_id: null, entity: "leads", entity_id: "lead_1", action: "update", diff: {}, created_at: "2026-10-11T12:00:00Z", ...overrides };
}

describe("describeActivity", () => {
  it("describes a stage move with the stage's name", () => {
    expect(describeActivity(entry({ diff: { stage_id: { old: "new", new: "won" } } }), ctx)).toBe("moved Jane Doe to Won");
  });

  it("describes inserts and deletes with the row's own name", () => {
    expect(describeActivity(entry({ action: "insert", entity: "customers", entity_id: "c9", diff: { name: "Sam Lee" } }), ctx)).toBe("added client Sam Lee");
    expect(describeActivity(entry({ action: "delete", entity: "jobs", entity_id: "job_x", diff: { title: "Deck" } }), ctx)).toBe("deleted job Deck");
  });

  it("describes job status, scheduling, owner and follow-up changes", () => {
    expect(describeActivity(entry({ entity: "jobs", entity_id: "job_1", diff: { status: { old: "planned", new: "complete" } } }), ctx)).toBe("marked Kitchen Remodel as complete");
    expect(describeActivity(entry({ entity: "jobs", entity_id: "job_1", diff: { scheduled_date: { old: null, new: "2026-10-20" } } }), ctx)).toBe("scheduled Kitchen Remodel for Oct 20");
    expect(describeActivity(entry({ diff: { owner_user_id: { old: null, new: "usr_1" } } }), ctx)).toBe("assigned Jane Doe to Victor");
    expect(describeActivity(entry({ diff: { next_action_date: { old: null, new: "2026-10-14" } } }), ctx)).toBe("set a follow-up on Jane Doe for Oct 14");
  });

  it("falls back to naming the changed fields", () => {
    expect(describeActivity(entry({ diff: { phone: { old: "", new: "555" }, email: { old: "", new: "a@b.c" }, zip: { old: "", new: "30097" } } }), ctx))
      .toBe("updated phone and email and 1 more on Jane Doe");
  });

  it("skips updates that only touched bookkeeping fields", () => {
    expect(describeActivity(entry({ diff: { updated_at: { old: "x", new: "y" }, lat: { old: 1, new: 2 } } }), ctx)).toBeNull();
  });

  it("summarizes user-admin events", () => {
    expect(describeActivity(entry({ entity: "user_permissions", diff: {} }), ctx)).toBe("changed user access settings");
  });
});

describe("describeActivity — sync noise and project money", () => {
  it("ignores calendar-sync and geocode bookkeeping", () => {
    expect(describeActivity(entry({ entity: "jobs", entity_id: "job_1", diff: { google_event_id: { old: null, new: "abc" } } }), ctx)).toBeNull();
  });

  it("describes finance rows with the job's name and amounts", () => {
    expect(describeActivity(entry({ entity: "project_financials", action: "insert", entity_id: "pf_1", diff: { job_id: "job_1" } }), ctx)).toBe("set up costing on Kitchen Remodel");
    expect(describeActivity(entry({ entity: "cost_line_items", action: "insert", entity_id: "cli_1", diff: { job_id: "job_1", description: "Hinges", estimated_cost: 240 } }), ctx))
      .toBe('added cost "Hinges" ($240) on Kitchen Remodel');
    expect(describeActivity(entry({ entity: "transactions", action: "insert", entity_id: "t1", diff: { job_id: "job_1", transaction_type: "customer_deposit", amount: 5000 } }), ctx))
      .toBe("logged a customer deposit of $5,000 on Kitchen Remodel");
    expect(describeActivity(entry({ entity: "profit_releases", action: "insert", entity_id: "pr1", diff: { job_id: "job_1", amount: 800 } }), ctx)).toBe("released $800 profit on Kitchen Remodel");
    expect(describeActivity(entry({ entity: "change_orders", action: "update", entity_id: "co1", diff: { status: { old: "draft", new: "approved" } } }), ctx)).toBe("approved a change order");
  });

  it("flags finance entries so non-owners don't see them", () => {
    expect(isFinanceActivity(entry({ entity: "transactions" }))).toBe(true);
    expect(isFinanceActivity(entry({ entity: "leads" }))).toBe(false);
  });
});
