// "My day" on the Dashboard: the follow-ups that are due (overdue first,
// most overdue on top) and the jobs scheduled for today, optionally only the
// ones owned by the signed-in user.
import { followUpStatus } from "./followUp";
import type { Job, Lead, PipelineStage } from "./types";

export interface DueFollowUp {
  lead: Lead;
  status: "overdue" | "today";
  daysOverdue: number;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function myDay(
  leads: Lead[],
  jobs: Job[],
  stages: PipelineStage[],
  today: string,
  ownerId: string | null // null = everyone
): { followUps: DueFollowUp[]; jobsToday: Job[] } {
  const owned = <T extends { owner_user_id?: string | null }>(r: T) => ownerId === null || r.owner_user_id === ownerId;

  const followUps: DueFollowUp[] = [];
  for (const lead of leads) {
    if (!owned(lead)) continue;
    const status = followUpStatus(lead, stages, today);
    if (status !== "overdue" && status !== "today") continue;
    followUps.push({ lead, status, daysOverdue: status === "overdue" ? daysBetween(lead.next_action_date as string, today) : 0 });
  }
  followUps.sort((a, b) => b.daysOverdue - a.daysOverdue || a.lead.name.localeCompare(b.lead.name));

  const jobsToday = jobs
    .filter(j => owned(j) && j.scheduled_date === today && j.status !== "complete")
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  return { followUps, jobsToday };
}
