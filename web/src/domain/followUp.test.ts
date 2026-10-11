import { describe, expect, it } from "vitest";
import { dueFollowUps, followUpStatus, leadsWithoutNextStep, lostReasonCounts } from "./followUp";
import type { Lead, PipelineStage } from "./types";

const stages = [
  { id: "new", type: "open" },
  { id: "won", type: "won" },
  { id: "lost", type: "lost" }
] as PipelineStage[];

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return { id, stage_id: "new", next_action_date: null, lost_reason: null, ...overrides } as Lead;
}

const TODAY = "2026-10-11";

describe("followUpStatus", () => {
  it("classifies open leads by their next action date", () => {
    expect(followUpStatus(lead("a", { next_action_date: "2026-10-10" }), stages, TODAY)).toBe("overdue");
    expect(followUpStatus(lead("b", { next_action_date: TODAY }), stages, TODAY)).toBe("today");
    expect(followUpStatus(lead("c", { next_action_date: "2026-10-20" }), stages, TODAY)).toBe("upcoming");
    expect(followUpStatus(lead("d"), stages, TODAY)).toBeNull();
  });

  it("ignores won and lost leads", () => {
    expect(followUpStatus(lead("a", { stage_id: "won", next_action_date: "2026-10-01" }), stages, TODAY)).toBeNull();
    expect(followUpStatus(lead("b", { stage_id: "lost", next_action_date: "2026-10-01" }), stages, TODAY)).toBeNull();
  });
});

describe("dueFollowUps / leadsWithoutNextStep", () => {
  const leads = [
    lead("late", { next_action_date: "2026-10-01" }),
    lead("now", { next_action_date: TODAY }),
    lead("later", { next_action_date: "2026-11-01" }),
    lead("none"),
    lead("closed", { stage_id: "won" })
  ];
  it("splits overdue from due today", () => {
    const { overdue, dueToday } = dueFollowUps(leads, stages, TODAY);
    expect(overdue.map(l => l.id)).toEqual(["late"]);
    expect(dueToday.map(l => l.id)).toEqual(["now"]);
  });
  it("finds open leads with no next step", () => {
    expect(leadsWithoutNextStep(leads, stages).map(l => l.id)).toEqual(["none"]);
  });
});

describe("lostReasonCounts", () => {
  it("counts reasons on lost leads only, most common first", () => {
    const leads = [
      lead("a", { stage_id: "lost", lost_reason: "No response" }),
      lead("b", { stage_id: "lost", lost_reason: "No response" }),
      lead("c", { stage_id: "lost", lost_reason: "Price too high" }),
      lead("d", { stage_id: "lost" }),
      lead("e", { stage_id: "new", lost_reason: "Price too high" })
    ];
    expect(lostReasonCounts(leads, stages)).toEqual([
      { reason: "No response", count: 2 },
      { reason: "Price too high", count: 1 },
      { reason: "Not recorded", count: 1 }
    ]);
  });
});
