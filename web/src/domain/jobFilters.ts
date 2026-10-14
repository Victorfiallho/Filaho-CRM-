// Filtering and sorting for the Jobs list and the Dashboard's upcoming jobs.
// scheduled_date is YYYY-MM-DD, compared with the local date (UTC would flip
// to tomorrow every evening in US time zones).
import type { Job } from "./types";

export type JobWhen = "all" | "upcoming" | "past" | "unscheduled";
export type JobSortKey = "title" | "status" | "client" | "date" | "value";

export function localToday(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function upcomingJobs(jobs: Job[], today: string, limit = 5): Job[] {
  return jobs
    .filter(j => j.scheduled_date && j.scheduled_date >= today && j.status !== "complete")
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .slice(0, limit);
}

export function filterJobs(
  jobs: Job[],
  { status, service, when }: { status: string; service: string; when: JobWhen },
  today: string
): Job[] {
  return jobs.filter(j => {
    if (status !== "all" && (j.status || "planned") !== status) return false;
    if (service !== "all" && j.service_type !== service) return false;
    if (when === "upcoming") return Boolean(j.scheduled_date) && j.scheduled_date >= today;
    if (when === "past") return Boolean(j.scheduled_date) && j.scheduled_date < today;
    if (when === "unscheduled") return !j.scheduled_date;
    return true;
  });
}

export function sortJobs(jobs: Job[], key: JobSortKey, dir: "asc" | "desc", clientName: (j: Job) => string): Job[] {
  const sorted = [...jobs].sort((a, b) => {
    if (key === "value") return Number(a.estimated_value || 0) - Number(b.estimated_value || 0);
    if (key === "date") {
      // Unscheduled jobs always sink to the end in ascending order.
      if (!a.scheduled_date || !b.scheduled_date) return a.scheduled_date ? -1 : b.scheduled_date ? 1 : 0;
      return a.scheduled_date.localeCompare(b.scheduled_date);
    }
    const value = (j: Job) => (key === "client" ? clientName(j) : key === "status" ? j.status || "planned" : j.title || "");
    return value(a).localeCompare(value(b));
  });
  return dir === "asc" ? sorted : sorted.reverse();
}
