import { AlertCircle, Calendar, CalendarClock, DollarSign, History } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import ProgressPill from "../components/ProgressPill";
import TrendLineChart from "../components/TrendLineChart";
import { activityWhen, useActivityFeed } from "../data/activityFeed";
import {
  useAuditLog,
  useCompanyChangeOrders,
  useCompanyCostLineItems,
  useCompanyProfitReleases,
  useCompanyProjectFinancials,
  useCompanyTransactions,
  useCurrentAppUser,
  useCustomers,
  useFinanceSettings,
  useIntegrationSettings,
  useIsOwner,
  useJobs,
  useLeads
} from "../data/hooks";
import { formatDay, money } from "../domain/format";
import { isOpenStage, isWonStage } from "../domain/pipelineStages";
import { leadsWithoutNextStep } from "../domain/followUp";
import { localToday, upcomingJobs } from "../domain/jobFilters";
import { myDay } from "../domain/myDay";
import { rollupCompanyProjects, type ProjectRollup } from "../domain/projectRollup";
import { weeklyTrend } from "../domain/trend";
import type { Customer, Job, Lead, PipelineStage } from "../domain/types";
import { stageTone } from "../domain/visual";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

// Stable reference: the filters object is part of the audit-log query key.
// Extra rows because noise-only updates are dropped before showing 8.
const ACTIVITY_FILTERS = { limit: 30 };
const ACTIVITY_SHOWN = 8;
const MY_DAY_SHOWN = 6;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Ported from app.js (metrics, renderDashboard, stageBar), then extended:
// "My day" (follow-ups + today's jobs), an owner-only money panel built on
// the same computeProjectFinancials rules as the finance screens, and an
// activity feed read from audit_log instead of guessed from updated_at.
export default function Dashboard() {
  const { activeCompanyId, stages } = useCompany();
  const { isOwner } = useIsOwner();
  const ownerCompanyId = isOwner ? activeCompanyId : null; // non-owners never fetch finance data
  const { data: customers = [], isLoading: customersLoading } = useCustomers(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: settings, isLoading: settingsLoading } = useIntegrationSettings();
  const { data: currentAppUser } = useCurrentAppUser();
  // Same query (same filters) the Activity card reads through useActivityFeed.
  const { isLoading: auditLoading } = useAuditLog(activeCompanyId, ACTIVITY_FILTERS);
  const { data: financeSettings, isLoading: fsLoading } = useFinanceSettings(ownerCompanyId);
  const { data: financials = [], isLoading: pfLoading } = useCompanyProjectFinancials(ownerCompanyId);
  const { data: costItems = [], isLoading: itemsLoading } = useCompanyCostLineItems(ownerCompanyId);
  const { data: changeOrders = [], isLoading: coLoading } = useCompanyChangeOrders(ownerCompanyId);
  const { data: transactions = [], isLoading: txnLoading } = useCompanyTransactions(ownerCompanyId);
  const { data: releases = [], isLoading: releasesLoading } = useCompanyProfitReleases(ownerCompanyId);
  const navigate = useNavigate();

  // Everything the page shows waits together, so panels don't pop in one by
  // one; disabled (non-owner) finance queries report not-loading.
  const loading = customersLoading || leadsLoading || jobsLoading || settingsLoading || auditLoading ||
    fsLoading || pfLoading || itemsLoading || coLoading || txnLoading || releasesLoading;
  if (loading) return <PageSkeleton kpis={4} rows={[6, 4, 5, 6]} />;

  const today = localToday();
  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const openLeads = leads.filter(l => isOpenStage(l.stage_id, stages));
  const pipelineValue = openLeads.reduce((t, l) => t + Number(l.value || 0), 0);
  const activeJobs = jobs.filter(j => j.status !== "complete");
  const scheduledJobs = jobs.filter(j => j.scheduled_date);
  const upcoming = upcomingJobs(jobs, today);

  // Follow-ups due now live in "My day" as a real list; this panel keeps the
  // data-quality and setup issues.
  const unscheduledJobs = jobs.filter(j => !j.scheduled_date && j.status !== "complete");
  const noContactLeads = leads.filter(l => !l.phone && !l.email);
  const calendarConnected = Boolean(settings?.google_calendar.enabled);
  const noNextStep = leadsWithoutNextStep(leads, stages);
  const alerts = [
    noNextStep.length > 0 && { text: `${plural(noNextStep.length, "open lead has", "open leads have")} no next step`, action: "Review", to: "/pipeline" },
    unscheduledJobs.length > 0 && { text: `${plural(unscheduledJobs.length, "job needs", "jobs need")} scheduling`, action: "Review", to: "/jobs" },
    noContactLeads.length > 0 && { text: `${plural(noContactLeads.length, "lead has", "leads have")} no contact info`, action: "Review", to: "/pipeline" },
    !calendarConnected && { text: "Google Calendar not connected", action: "Connect", to: "/integrations" }
  ].filter(Boolean) as { text: string; action: string; to: string }[];

  const stageCounts = stages.map(stage => ({ stage, count: leads.filter(l => l.stage_id === stage.id).length }));
  const maxStageCount = Math.max(1, ...stageCounts.map(s => s.count));
  const leadsPerWeek = weeklyTrend(leads, l => l.created_at, () => 1, 12);
  // Dot-matrix trends for the KPI strip: last 10 weeks of new records.
  const weekly = <T,>(rows: T[], dateOf: (r: T) => string, valueOf: (r: T) => number = () => 1) =>
    weeklyTrend(rows, dateOf, valueOf, 10).map(p => p.value);

  const rollups = isOwner
    ? rollupCompanyProjects({
      jobs, financials, items: costItems, changeOrders, transactions, releases,
      defaultMinMargin: financeSettings?.default_minimum_margin_pct ?? 35,
      defaultContingency: financeSettings?.default_contingency_pct ?? 10
    })
    : [];

  const integrationsConnected = [
    Boolean(settings?.google_maps.enabled),
    calendarConnected,
    Boolean(settings?.google_sheets.enabled),
    Boolean(settings?.google_drive.enabled),
    Boolean(settings?.email_sms.enabled),
    Boolean(settings?.meta_ads.enabled)
  ].filter(Boolean).length;

  return (
    <div className="view-enter">
      <KpiStrip items={[
        { label: "Clients", value: customers.length, hint: "active records", tone: "amber", series: weekly(customers, c => c.created_at), seriesLabel: "New clients per week, last 10 weeks" },
        { label: "Open leads", value: openLeads.length, hint: `${won.length} won`, tone: "blue", series: weekly(leads, l => l.created_at), seriesLabel: "New leads per week, last 10 weeks" },
        { label: "Active jobs", value: activeJobs.length, hint: `${scheduledJobs.length} scheduled`, tone: "coral", series: weekly(jobs, j => j.created_at), seriesLabel: "New jobs per week, last 10 weeks" },
        { label: "Pipeline", value: money(pipelineValue), hint: "open lead value", tone: "green", series: weekly(leads, l => l.created_at, l => Number(l.value || 0)), seriesLabel: "Lead value added per week, last 10 weeks" }
      ]} />

      <div className="grid two" style={{ marginTop: 20 }}>
        <MyDayCard leads={leads} jobs={jobs} customers={customers} stages={stages} today={today} myUserId={currentAppUser?.id ?? null} />
        <section className="card">
          <div className="card-h"><h3>Needs attention</h3>{alerts.length > 0 && <span className="badge-tone tone-amber">{alerts.length}</span>}</div>
          <div className="card-b">
            {alerts.length ? alerts.map(a => (
              <div className="attention-row" key={a.text}>
                <span>{a.text}</span>
                <button className="link-btn" onClick={() => navigate(a.to)}>{a.action}</button>
              </div>
            )) : <EmptyState icon={AlertCircle}>All caught up</EmptyState>}
          </div>
        </section>
      </div>

      {isOwner && <MoneyCard rollups={rollups} />}

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-h">
          <h3>New leads</h3>
          <span className="sub">Last 12 weeks</span>
        </div>
        <div className="card-b">
          <TrendLineChart data={leadsPerWeek} />
        </div>
      </section>

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <div className="card-h">
            <h3>Upcoming jobs</h3>
            <button className="link-btn" onClick={() => navigate("/calendar")}>View calendar</button>
          </div>
          <div className="card-b">
            {upcoming.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Client</th><th>Project</th><th>Location</th><th>Status</th></tr></thead>
                  <tbody>
                    {upcoming.map(job => {
                      const status = job.status || "planned";
                      return (
                        <tr key={job.id} className="row-clickable" onClick={() => navigate("/calendar")}>
                          <td>{formatDay(job.scheduled_date)}</td>
                          <td>{job.customer_name || "—"}</td>
                          <td>{job.title}</td>
                          <td>{job.city || "—"}</td>
                          <td><span className={`pill status-${status.replace(/\s+/g, "-")}`}>{status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Calendar}>No upcoming jobs scheduled</EmptyState>}
          </div>
        </section>
        <section className="card">
          <div className="card-h">
            <h3>Pipeline by stage</h3>
            <button className="link-btn" onClick={() => navigate("/pipeline")}>View pipeline</button>
          </div>
          <div className="card-b">
            {stageCounts.map(({ stage, count }, i) => {
              const tone = stageTone(stage, i);
              return (
                <div className={`stage-meter tone-${tone}`} key={stage.id}>
                  <span className="stage-meter-name">{stage.name}</span>
                  <ProgressPill value={count} max={maxStageCount} tone={tone} label={`${stage.name}: ${count} leads`} />
                  <span className="stage-meter-count">{count}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <ActivityCard />

      <p className="dash-foot">
        Integrations: {integrationsConnected} of 6 connected · <button className="link-btn" onClick={() => navigate("/integrations")}>Manage integrations</button>
      </p>
    </div>
  );
}

// Follow-ups that are due (overdue first) and today's jobs, as clickable
// rows — the Dashboard used to show only "3 follow-ups are overdue".
function MyDayCard({ leads, jobs, customers, stages, today, myUserId }: {
  leads: Lead[]; jobs: Job[]; customers: Customer[]; stages: PipelineStage[]; today: string; myUserId: string | null;
}) {
  const { openRecordModal } = useModal();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"mine" | "everyone">(myUserId ? "mine" : "everyone");
  const { followUps, jobsToday } = myDay(leads, jobs, stages, today, scope === "mine" ? myUserId : null);
  const clientName = new Map(customers.map(c => [c.id, c.name]));

  return (
    <section className="card">
      <div className="card-h">
        <div><h3>My day</h3><span className="sub">{formatDay(today)}</span></div>
        {myUserId && (
          <div className="seg" role="group" aria-label="Whose items">
            <button type="button" className={scope === "mine" ? "active" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Mine</button>
            <button type="button" className={scope === "everyone" ? "active" : ""} aria-pressed={scope === "everyone"} onClick={() => setScope("everyone")}>Everyone</button>
          </div>
        )}
      </div>
      <div className="card-b">
        {followUps.length === 0 && jobsToday.length === 0 && (
          <EmptyState icon={CalendarClock}>Nothing due {scope === "mine" ? "for you " : ""}today</EmptyState>
        )}
        {followUps.length > 0 && (
          <>
            <div className="day-section">Follow-ups · {followUps.length}</div>
            {followUps.slice(0, MY_DAY_SHOWN).map(({ lead, status, daysOverdue }) => (
              <button type="button" className="day-row" key={lead.id} onClick={() => openRecordModal("lead", lead)}>
                <span className="day-row-main">
                  <b>{lead.name}</b>
                  <span className="sub">{lead.next_action || "Follow up"}</span>
                </span>
                <span className={`pill ${status === "overdue" ? "pill-danger" : "pill-warn"}`}>
                  {status === "overdue" ? `${daysOverdue}d overdue` : "Today"}
                </span>
              </button>
            ))}
            {followUps.length > MY_DAY_SHOWN && (
              <button className="link-btn" onClick={() => navigate("/pipeline")}>+{followUps.length - MY_DAY_SHOWN} more in Pipeline</button>
            )}
          </>
        )}
        {jobsToday.length > 0 && (
          <>
            <div className="day-section">Jobs today · {jobsToday.length}</div>
            {jobsToday.slice(0, MY_DAY_SHOWN).map(job => (
              <button type="button" className="day-row" key={job.id} onClick={() => openRecordModal("job", job)}>
                <span className="day-row-main">
                  <b>{job.title}</b>
                  <span className="sub">{[clientName.get(job.customer_id || ""), job.city].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <span className={`pill status-${(job.status || "planned").replace(/\s+/g, "-")}`}>{job.status || "planned"}</span>
              </button>
            ))}
            {jobsToday.length > MY_DAY_SHOWN && (
              <button className="link-btn" onClick={() => navigate("/calendar")}>+{jobsToday.length - MY_DAY_SHOWN} more in Calendar</button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Owner-only. Same per-project numbers as Company Financials: what customers
// still owe, what's safe to withdraw, and which projects are under margin.
function MoneyCard({ rollups }: { rollups: ProjectRollup[] }) {
  const receivable = rollups.reduce((t, r) => t + r.balanceDue, 0);
  const owingCount = rollups.filter(r => r.balanceDue > 0).length;
  const credits = rollups.reduce((t, r) => t + r.customerCredit, 0);
  const safe = rollups.reduce((t, r) => t + r.safeWithdraw, 0);
  const priced = rollups.filter(r => r.hasCostData);
  const unpriced = rollups.length - priced.length;
  const belowMargin = priced
    .filter(r => r.forecastMarginValue < r.minimumMarginPct)
    .sort((a, b) => a.forecastMarginValue - b.forecastMarginValue)
    .slice(0, 3);

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="card-h">
        <div><h3>Money</h3><span className="sub">{plural(rollups.length, "project", "projects")} with costing · owner only</span></div>
        <Link className="link-btn" to="/company-financials">Company Financials</Link>
      </div>
      <div className="card-b">
        {rollups.length === 0 ? (
          <EmptyState icon={DollarSign}>No projects have costing set up yet — open a job's Costing to start.</EmptyState>
        ) : (
          <>
            <div className="money-stats">
              <div>
                <span className="label">To collect</span>
                <b>{money(receivable)}</b>
                <span className="sub">{owingCount ? `from ${plural(owingCount, "project", "projects")}` : "Nothing outstanding"}</span>
              </div>
              <div>
                <span className="label">Safe to withdraw</span>
                <b>{money(safe)}</b>
                <span className="sub">{unpriced ? `${plural(unpriced, "project", "projects")} held — no cost estimates` : "After all reserves"}</span>
              </div>
              <div>
                <span className="label">Customer credits</span>
                <b>{money(credits)}</b>
                <span className="sub">{credits > 0 ? "Paid above contract — refund or apply" : "None"}</span>
              </div>
            </div>
            {belowMargin.length > 0 ? (
              <>
                <div className="day-section">Below minimum margin</div>
                {belowMargin.map(r => (
                  <Link className="day-row" key={r.job.id} to={`/jobs/${r.job.id}/financials`}>
                    <span className="day-row-main"><b>{r.job.title}</b><span className="sub">Forecast profit {money(r.forecastProfitValue)}</span></span>
                    <span className="pill pill-danger">{r.forecastMarginValue.toFixed(1)}% / {r.minimumMarginPct}%</span>
                  </Link>
                ))}
              </>
            ) : priced.length > 0 && <p className="sub" style={{ marginTop: 12 }}>Every priced project is at or above its minimum margin.</p>}
          </>
        )}
      </div>
    </section>
  );
}

// Who did what, from audit_log (now also covering leads — migration 09).
function ActivityCard() {
  const { items } = useActivityFeed(ACTIVITY_SHOWN);
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="card-h">
        <h3>Activity</h3>
        <Link className="link-btn" to="/audit-log">Full audit log</Link>
      </div>
      <div className="card-b">
        {items.length ? items.map(({ row, actor, text }) => (
          <div className="activity-row" key={row.id}>
            <span><b>{actor}</b> {text}</span>
            <span className="sub" style={{ whiteSpace: "nowrap" }}>{activityWhen(row.created_at)}</span>
          </div>
        )) : <EmptyState icon={History}>No activity yet</EmptyState>}
      </div>
    </section>
  );
}
