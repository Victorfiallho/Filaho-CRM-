import { describe, expect, it } from "vitest";
import { myDay } from "./myDay";
import type { Job, Lead, PipelineStage } from "./types";

const stages = [{ id: "new", type: "open" }, { id: "won", type: "won" }] as PipelineStage[];
const TODAY = "2026-10-11";

const lead = (id: string, o: Partial<Lead> = {}) => ({ id, name: id, stage_id: "new", next_action_date: null, owner_user_id: null, ...o }) as Lead;
const job = (id: string, o: Partial<Job> = {}) => ({ id, title: id, status: "scheduled", scheduled_date: "", owner_user_id: null, ...o }) as Job;

describe("myDay", () => {
  const leads = [
    lead("a", { next_action_date: "2026-10-10", owner_user_id: "me" }),
    lead("b", { next_action_date: "2026-10-01", owner_user_id: "other" }),
    lead("c", { next_action_date: TODAY, owner_user_id: "me" }),
    lead("d", { next_action_date: "2026-10-20", owner_user_id: "me" }),
    lead("e", { next_action_date: "2026-10-01", stage_id: "won", owner_user_id: "me" })
  ];
  const jobs = [
    job("j1", { scheduled_date: TODAY, owner_user_id: "me" }),
    job("j2", { scheduled_date: TODAY, owner_user_id: "other" }),
    job("j3", { scheduled_date: TODAY, status: "complete", owner_user_id: "me" }),
    job("j4", { scheduled_date: "2026-10-12", owner_user_id: "me" })
  ];

  it("lists everyone's due follow-ups, most overdue first, skipping closed and future ones", () => {
    const { followUps } = myDay(leads, jobs, stages, TODAY, null);
    expect(followUps.map(f => [f.lead.id, f.status, f.daysOverdue])).toEqual([["b", "overdue", 10], ["a", "overdue", 1], ["c", "today", 0]]);
  });

  it("narrows to one owner", () => {
    const { followUps, jobsToday } = myDay(leads, jobs, stages, TODAY, "me");
    expect(followUps.map(f => f.lead.id)).toEqual(["a", "c"]);
    expect(jobsToday.map(j => j.id)).toEqual(["j1"]);
  });

  it("lists today's unfinished jobs", () => {
    expect(myDay(leads, jobs, stages, TODAY, null).jobsToday.map(j => j.id)).toEqual(["j1", "j2"]);
  });
});
