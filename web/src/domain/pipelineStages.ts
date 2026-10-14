// A stage's `type` (won / lost / open) drives reporting, not its name or
// id, so a company can rename "Won" or add stages without breaking KPIs.
// Anything not won or lost is open.
import type { PipelineStage } from "./types";

export type StageType = "open" | "won" | "lost";

export const STAGE_TYPES: StageType[] = ["open", "won", "lost"];

export function isWonStage(stageId: string, stages: PipelineStage[]): boolean {
  return stages.some(s => s.id === stageId && s.type === "won");
}

export function isLostStage(stageId: string, stages: PipelineStage[]): boolean {
  return stages.some(s => s.id === stageId && s.type === "lost");
}

export function isOpenStage(stageId: string, stages: PipelineStage[]): boolean {
  return !isWonStage(stageId, stages) && !isLostStage(stageId, stages);
}

export function slugifyStageId(name: string, existingIds: string[]): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "stage";
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
