import { describe, expect, it } from "vitest";
import { filterJobs, localToday, sortJobs, upcomingJobs } from "./jobFilters";
import type { Job } from "./types";

function job(id: string, overrides: Partial<Job> = {}): Job {
  return { id, title: id, status: "planned", service_type: "Cabinets", scheduled_date: "", estimated_value: 0, ...overrides } as Job;
}

const TODAY = "2026-10-11";

describe("localToday", () => {
  it("uses the local calendar date, zero-padded", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("upcomingJobs", () => {
  it("skips past and completed jobs and sorts soonest first", () => {
    const jobs = [
      job("past", { scheduled_date: "2026-10-01" }),
      job("later", { scheduled_date: "2026-11-02" }),
      job("today", { scheduled_date: TODAY }),
      job("done", { scheduled_date: "2026-10-20", status: "complete" }),
      job("none")
    ];
    expect(upcomingJobs(jobs, TODAY).map(j => j.id)).toEqual(["today", "later"]);
  });

  it("caps the list", () => {
    const jobs = ["2026-10-12", "2026-10-13", "2026-10-14"].map((d, i) => job(`j${i}`, { scheduled_date: d }));
    expect(upcomingJobs(jobs, TODAY, 2)).toHaveLength(2);
  });
});

describe("filterJobs", () => {
  const jobs = [
    job("a", { scheduled_date: "2026-10-01", status: "complete" }),
    job("b", { scheduled_date: "2026-10-15", service_type: "Flooring" }),
    job("c")
  ];
  it("filters by when", () => {
    expect(filterJobs(jobs, { status: "all", service: "all", when: "past" }, TODAY).map(j => j.id)).toEqual(["a"]);
    expect(filterJobs(jobs, { status: "all", service: "all", when: "upcoming" }, TODAY).map(j => j.id)).toEqual(["b"]);
    expect(filterJobs(jobs, { status: "all", service: "all", when: "unscheduled" }, TODAY).map(j => j.id)).toEqual(["c"]);
  });
  it("filters by status and service", () => {
    expect(filterJobs(jobs, { status: "complete", service: "all", when: "all" }, TODAY).map(j => j.id)).toEqual(["a"]);
    expect(filterJobs(jobs, { status: "all", service: "Flooring", when: "all" }, TODAY).map(j => j.id)).toEqual(["b"]);
  });
});

describe("sortJobs", () => {
  const jobs = [
    job("x", { scheduled_date: "2026-10-20", estimated_value: 500 }),
    job("y", { estimated_value: 9000 }),
    job("z", { scheduled_date: "2026-10-12", estimated_value: 100 })
  ];
  it("sorts by date with unscheduled last", () => {
    expect(sortJobs(jobs, "date", "asc", () => "").map(j => j.id)).toEqual(["z", "x", "y"]);
  });
  it("sorts by value descending", () => {
    expect(sortJobs(jobs, "value", "desc", () => "").map(j => j.id)).toEqual(["y", "x", "z"]);
  });
});
