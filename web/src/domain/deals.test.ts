import { describe, expect, it } from "vitest";
import { dealsForClient, dealTitle } from "./deals";
import type { Lead, PipelineStage } from "./types";

const stages = [
  { id: "new", type: "open" },
  { id: "won", type: "won" },
  { id: "lost", type: "lost" }
] as PipelineStage[];

const lead = (id: string, customer_id: string, stage_id: string, created_at: string, extra: Partial<Lead> = {}) =>
  ({ id, customer_id, stage_id, created_at, service_type: "Kitchen Cabinets", title: "", ...extra }) as Lead;

describe("dealTitle", () => {
  it("uses the deal's title, then the service", () => {
    expect(dealTitle({ title: " Master bathroom ", service_type: "Bathroom Vanities" })).toBe("Master bathroom");
    expect(dealTitle({ title: "", service_type: "Bathroom Vanities" })).toBe("Bathroom Vanities");
    expect(dealTitle({ title: undefined, service_type: "" })).toBe("");
  });
});

describe("dealsForClient", () => {
  it("lists only that client's deals, open first and newest first", () => {
    const leads = [
      lead("a", "c1", "won", "2026-09-01"),
      lead("b", "c1", "new", "2026-08-01"),
      lead("c", "c2", "new", "2026-10-01"),
      lead("d", "c1", "lost", "2026-10-05"),
      lead("e", "c1", "new", "2026-10-02")
    ];
    expect(dealsForClient(leads, "c1", stages).map(l => l.id)).toEqual(["e", "b", "a", "d"]);
  });
});
