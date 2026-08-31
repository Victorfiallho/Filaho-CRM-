import { describe, expect, it } from "vitest";
import { isLostStage, isOpenStage, isWonStage, slugifyStageId } from "./pipelineStages";
import type { PipelineStage } from "./types";

function stage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return { id: "new", company_id: "peach_fresh", name: "New", order: 1, color: "#667085", type: "open", win_probability: 0.5, ...overrides };
}

const stages: PipelineStage[] = [
  stage({ id: "new", type: "open" }),
  stage({ id: "fechado", name: "Fechado", type: "won" }),
  stage({ id: "perdido", name: "Perdido", type: "lost" })
];

describe("isWonStage / isLostStage / isOpenStage", () => {
  it("classifies a stage by its type field, not by id text", () => {
    expect(isWonStage("fechado", stages)).toBe(true);
    expect(isWonStage("new", stages)).toBe(false);
    expect(isLostStage("perdido", stages)).toBe(true);
    expect(isOpenStage("new", stages)).toBe(true);
    expect(isOpenStage("fechado", stages)).toBe(false);
    expect(isOpenStage("perdido", stages)).toBe(false);
  });

  it("treats an unknown stage id as open (not won/lost)", () => {
    expect(isWonStage("missing", stages)).toBe(false);
    expect(isLostStage("missing", stages)).toBe(false);
    expect(isOpenStage("missing", stages)).toBe(true);
  });
});

describe("slugifyStageId", () => {
  it("lowercases and replaces non-alphanumerics with underscores", () => {
    expect(slugifyStageId("Estimate Sent", [])).toBe("estimate_sent");
  });

  it("appends a numeric suffix on collision", () => {
    expect(slugifyStageId("New", ["new"])).toBe("new_2");
    expect(slugifyStageId("New", ["new", "new_2"])).toBe("new_3");
  });

  it("falls back to 'stage' for a name with no alphanumeric characters", () => {
    expect(slugifyStageId("!!!", [])).toBe("stage");
  });
});
