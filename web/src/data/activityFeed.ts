// The "who did what" feed (audit_log, one sentence per row), shared by the
// Dashboard's Activity card, the TopNav bell and the Audit Log so all three
// name records, stages and people the same way.
import { describeActivity, isFinanceActivity, type ActivityContext } from "../domain/activity";
import { relativeDate } from "../domain/format";
import type { AuditLogEntry } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useAuditLog, useCurrentAppUser, useCustomers, useIsOwner, useJobs, useLeads, useUsers } from "./hooks";

export interface ActivityItem {
  row: AuditLogEntry;
  actor: string;
  text: string;
}

// Stable reference: the filters object is part of the audit-log query key.
// Extra rows because noise-only updates are dropped before trimming.
const FILTERS = { limit: 30 };

// What describeActivity() needs to name records, stages and users, plus who
// did it. Shared by the feed below and the Audit Log.
export function useActivityContext(): { ctx: ActivityContext; actorFor: (row: AuditLogEntry) => string } {
  const { activeCompanyId, stages } = useCompany();
  const { t, locale } = useT();
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: users = [] } = useUsers();
  const { session } = useAuth();
  const { data: me } = useCurrentAppUser();

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
  // A login without a named profile in Users still did the action: name the
  // signed-in person from their login, and anyone else as "someone", never
  // "System" (that's for rows with no user at all: triggers, scripts).
  const myId = session?.user.id;
  const myName = me?.name || session?.user.user_metadata?.full_name || session?.user.user_metadata?.name || session?.user.email || "";
  const actorName = (authId: string | null) => {
    if (!authId) return t("act.actor.system");
    const name = userByAuthId.get(authId) || (authId === myId ? myName : "");
    return name || t("act.actor.teammate");
  };

  return {
    ctx: {
      nameFor: (entity, id) => names[entity]?.get(id),
      stageName: id => stageName.get(id),
      userName: id => userByAppId.get(id),
      t,
      locale
    },
    actorFor: row => (row.entity === "booking_requests" ? t("act.actor.booking") : row.entity === "messages" ? t("act.actor.message") : actorName(row.user_id))
  };
}

export function useActivityFeed(limit: number): { items: ActivityItem[]; isLoading: boolean } {
  const { activeCompanyId } = useCompany();
  const { isOwner } = useIsOwner();
  const { data: rows = [], isLoading } = useAuditLog(activeCompanyId, FILTERS);
  const { ctx, actorFor } = useActivityContext();

  const items = (isOwner ? rows : rows.filter(r => !isFinanceActivity(r)))
    .map(row => ({ row, actor: actorFor(row), text: describeActivity(row, ctx) }))
    .filter((x): x is ActivityItem => Boolean(x.text))
    .slice(0, limit);

  return { items, isLoading };
}

// "Today, 2:05 PM" / "Yesterday" / "Oct 5", in the app language.
export function activityWhen(iso: string, now: Date = new Date(), locale = "en-US"): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) {
    return `${relativeDate(iso, now, locale)}, ${d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
  }
  return relativeDate(iso, now, locale);
}
