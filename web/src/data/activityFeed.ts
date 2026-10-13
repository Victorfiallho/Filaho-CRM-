// The "who did what" feed (audit_log → one sentence per row), shared by the
// Dashboard's Activity card and the TopNav bell. Moved out of Dashboard.tsx
// unchanged so both read the same rows with the same naming rules.
import { describeActivity, isFinanceActivity } from "../domain/activity";
import type { AuditLogEntry } from "../domain/types";
import { useCompany } from "../state/CompanyContext";
import { useAuditLog, useCustomers, useIsOwner, useJobs, useLeads, useUsers } from "./hooks";

export interface ActivityItem {
  row: AuditLogEntry;
  actor: string;
  text: string;
}

// Stable reference: the filters object is part of the audit-log query key.
// Extra rows because noise-only updates are dropped before trimming.
const FILTERS = { limit: 30 };

export function useActivityFeed(limit: number): { items: ActivityItem[]; isLoading: boolean } {
  const { activeCompanyId, stages } = useCompany();
  const { isOwner } = useIsOwner();
  const { data: rows = [], isLoading } = useAuditLog(activeCompanyId, FILTERS);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: users = [] } = useUsers();

  const names: Record<string, Map<string, string>> = {
    leads: new Map(leads.map(l => [l.id, l.name])),
    jobs: new Map(jobs.map(j => [j.id, j.title])),
    customers: new Map(customers.map(c => [c.id, c.name])),
    pipeline_stages: new Map(stages.map(s => [s.id, s.name]))
  };
  const stageName = new Map(stages.map(s => [s.id, s.name]));
  const userByAppId = new Map(users.map(u => [u.id, u.name]));
  // audit_log.user_id is the auth uuid, not users.id.
  const userByAuthId = new Map(users.filter(u => u.auth_user_id).map(u => [u.auth_user_id as string, u.name]));

  const items = (isOwner ? rows : rows.filter(r => !isFinanceActivity(r)))
    .map(row => ({
      row,
      actor: row.entity === "booking_requests" ? "New online booking" : userByAuthId.get(row.user_id || "") || "System",
      text: describeActivity(row, {
        nameFor: (entity, id) => names[entity]?.get(id),
        stageName: id => stageName.get(id),
        userName: id => userByAppId.get(id)
      })
    }))
    .filter((x): x is ActivityItem => Boolean(x.text))
    .slice(0, limit);

  return { items, isLoading };
}

export function activityWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
