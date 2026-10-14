// Follow-ups and lost reasons over deals + stages, so the Pipeline cards,
// the Dashboard and Reports agree on what "overdue" means. Dates are
// YYYY-MM-DD compared with the local day (localToday in jobFilters.ts).
import { isLostStage, isOpenStage } from "./pipelineStages";
import type { Lead, PipelineStage } from "./types";

export const LOST_REASONS = [
  "Price too high",
  "Chose a competitor",
  "No response",
  "Postponed / not now",
  "Outside service area",
  "Other"
] as const;

export type FollowUpStatus = "overdue" | "today" | "upcoming";

// Closed (won/lost) deals are never due.
export function followUpStatus(lead: Lead, stages: PipelineStage[], today: string): FollowUpStatus | null {
  if (!lead.next_action_date || !isOpenStage(lead.stage_id, stages)) return null;
  if (lead.next_action_date < today) return "overdue";
  if (lead.next_action_date === today) return "today";
  return "upcoming";
}

// Open deals with nothing scheduled: the ones most likely to be forgotten.
export function leadsWithoutNextStep(leads: Lead[], stages: PipelineStage[]): Lead[] {
  return leads.filter(l => isOpenStage(l.stage_id, stages) && !l.next_action_date);
}

export function lostReasonCounts(leads: Lead[], stages: PipelineStage[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    if (!isLostStage(lead.stage_id, stages)) continue;
    const reason = lead.lost_reason?.trim() || "Not recorded";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}
