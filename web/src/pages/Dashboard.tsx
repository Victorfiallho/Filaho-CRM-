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
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

// Stable reference: the filters object is part of the audit-log query key.
// Extra rows because noise-only updates are dropped before showing 8.
const ACTIVITY_FILTERS = { limit: 30 };
const ACTIVITY_SHOWN = 8;
const MY_DAY_SHOWN = 6;

// Job statuses are stored in English; show them in the UI language.
const statusLabel = (t: (k: MessageKey) => string, status: string) =>
  (["planned", "scheduled", "in progress", "complete"].includes(status) ? t(`status.${status}` as MessageKey) : status);

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
  const { t, tn, locale } = useT();

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
    noNextStep.length > 0 && { text: tn("dash.alert.noNextStep", noNextStep.length), action: t("common.review"), to: "/pipeline" },
    unscheduledJobs.length > 0 && { text: tn("dash.alert.unscheduled", unscheduledJobs.length), action: t("common.review"), to: "/jobs" },
    noContactLeads.length > 0 && { text: tn("dash.alert.noContact", noContactLeads.length), action: t("common.review"), to: "/pipeline" },
    !calendarConnected && { text: t("dash.alert.calendar"), action: t("common.connect"), to: "/integrations" }
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
        { label: t("dash.kpi.clients"), value: customers.length, hint: t("dash.kpi.clientsHint"), tone: "amber", series: weekly(customers, c => c.created_at), seriesLabel: t("dash.kpi.clientsTrend") },
        { label: t("dash.kpi.openLeads"), value: openLeads.length, hint: t("dash.kpi.openLeadsHint", { count: won.length }), tone: "blue", series: weekly(leads, l => l.created_at), seriesLabel: t("dash.kpi.openLeadsTrend") },
        { label: t("dash.kpi.activeJobs"), value: activeJobs.length, hint: t("dash.kpi.activeJobsHint", { count: scheduledJobs.length }), tone: "coral", series: weekly(jobs, j => j.created_at), seriesLabel: t("dash.kpi.activeJobsTrend") },
        { label: t("dash.kpi.pipeline"), value: money(pipelineValue), hint: t("dash.kpi.pipelineHint"), tone: "green", series: weekly(leads, l => l.created_at, l => Number(l.value || 0)), seriesLabel: t("dash.kpi.pipelineTrend") }
      ]} />

      <div className="grid two" style={{ marginTop: 20 }}>
        <MyDayCard leads={leads} jobs={jobs} customers={customers} stages={stages} today={today} myUserId={currentAppUser?.id ?? null} />
        <section className="card">
          <div className="card-h"><h3>{t("dash.needsAttention")}</h3>{alerts.length > 0 && <span className="badge-tone tone-amber">{alerts.length}</span>}</div>
          <div className="card-b">
            {alerts.length ? alerts.map(a => (
              <div className="attention-row" key={a.text}>
                <span>{a.text}</span>
                <button className="link-btn" onClick={() => navigate(a.to)}>{a.action}</button>
              </div>
            )) : <EmptyState icon={AlertCircle}>{t("dash.allCaughtUp")}</EmptyState>}
          </div>
        </section>
      </div>

      {isOwner && <MoneyCard rollups={rollups} />}

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-h">
          <h3>{t("dash.newLeads")}</h3>
          <span className="sub">{t("dash.last12Weeks")}</span>
        </div>
        <div className="card-b">
          <TrendLineChart data={leadsPerWeek} unit={[t("chart.newLead"), t("chart.newLeads")]} />
        </div>
      </section>

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <div className="card-h">
            <h3>{t("dash.upcomingJobs")}</h3>
            <button className="link-btn" onClick={() => navigate("/calendar")}>{t("dash.viewCalendar")}</button>
          </div>
          <div className="card-b">
            {upcoming.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("dash.col.date")}</th><th>{t("dash.col.client")}</th><th>{t("dash.col.project")}</th><th>{t("dash.col.location")}</th><th>{t("dash.col.status")}</th></tr></thead>
                  <tbody>
                    {upcoming.map(job => {
                      const status = job.status || "planned";
                      return (
                        <tr key={job.id} className="row-clickable" onClick={() => navigate("/calendar")}>
                          <td>{formatDay(job.scheduled_date, undefined, locale)}</td>
                          <td>{job.customer_name || "—"}</td>
                          <td>{job.title}</td>
                          <td>{job.city || "—"}</td>
                          <td><span className={`pill status-${status.replace(/\s+/g, "-")}`}>{statusLabel(t, status)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Calendar}>{t("dash.noUpcoming")}</EmptyState>}
          </div>
        </section>
        <section className="card">
          <div className="card-h">
            <h3>{t("dash.pipelineByStage")}</h3>
            <button className="link-btn" onClick={() => navigate("/pipeline")}>{t("dash.viewPipeline")}</button>
          </div>
          <div className="card-b">
            {stageCounts.map(({ stage, count }, i) => {
              const tone = stageTone(stage, i);
              return (
                <div className={`stage-meter tone-${tone}`} key={stage.id}>
                  <span className="stage-meter-name">{stage.name}</span>
                  <ProgressPill value={count} max={maxStageCount} tone={tone} label={t("dash.stageLeads", { stage: stage.name, count })} />
                  <span className="stage-meter-count">{count}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <ActivityCard />

      <p className="dash-foot">
        {t("dash.integrations", { count: integrationsConnected })} · <button className="link-btn" onClick={() => navigate("/integrations")}>{t("dash.manageIntegrations")}</button>
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
  const { t, locale } = useT();
  const [scope, setScope] = useState<"mine" | "everyone">(myUserId ? "mine" : "everyone");
  const { followUps, jobsToday } = myDay(leads, jobs, stages, today, scope === "mine" ? myUserId : null);
  const clientName = new Map(customers.map(c => [c.id, c.name]));

  return (
    <section className="card">
      <div className="card-h">
        <div><h3>{t("dash.myDay")}</h3><span className="sub">{formatDay(today, undefined, locale)}</span></div>
        {myUserId && (
          <div className="seg" role="group" aria-label={t("dash.whose")}>
            <button type="button" className={scope === "mine" ? "active" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("dash.mine")}</button>
            <button type="button" className={scope === "everyone" ? "active" : ""} aria-pressed={scope === "everyone"} onClick={() => setScope("everyone")}>{t("dash.everyone")}</button>
          </div>
        )}
      </div>
      <div className="card-b">
        {followUps.length === 0 && jobsToday.length === 0 && (
          <EmptyState icon={CalendarClock}>{scope === "mine" ? t("dash.nothingDueMine") : t("dash.nothingDue")}</EmptyState>
        )}
        {followUps.length > 0 && (
          <>
            <div className="day-section">{t("dash.followUps", { count: followUps.length })}</div>
            {followUps.slice(0, MY_DAY_SHOWN).map(({ lead, status, daysOverdue }) => (
              <button type="button" className="day-row" key={lead.id} onClick={() => openRecordModal("lead", lead)}>
                <span className="day-row-main">
                  <b>{lead.name}</b>
                  <span className="sub">{lead.next_action || t("dash.followUp")}</span>
                </span>
                <span className={`pill ${status === "overdue" ? "pill-danger" : "pill-warn"}`}>
                  {status === "overdue" ? t("dash.overdue", { days: daysOverdue }) : t("dash.today")}
                </span>
              </button>
            ))}
            {followUps.length > MY_DAY_SHOWN && (
              <button className="link-btn" onClick={() => navigate("/pipeline")}>{t("dash.moreInPipeline", { count: followUps.length - MY_DAY_SHOWN })}</button>
            )}
          </>
        )}
        {jobsToday.length > 0 && (
          <>
            <div className="day-section">{t("dash.jobsToday", { count: jobsToday.length })}</div>
            {jobsToday.slice(0, MY_DAY_SHOWN).map(job => (
              <button type="button" className="day-row" key={job.id} onClick={() => openRecordModal("job", job)}>
                <span className="day-row-main">
                  <b>{job.title}</b>
                  <span className="sub">{[clientName.get(job.customer_id || ""), job.city].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <span className={`pill status-${(job.status || "planned").replace(/\s+/g, "-")}`}>{statusLabel(t, job.status || "planned")}</span>
              </button>
            ))}
            {jobsToday.length > MY_DAY_SHOWN && (
              <button className="link-btn" onClick={() => navigate("/calendar")}>{t("dash.moreInCalendar", { count: jobsToday.length - MY_DAY_SHOWN })}</button>
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
  const { t, tn } = useT();
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
        <div><h3>{t("dash.money")}</h3><span className="sub">{tn("dash.moneySub", rollups.length)}</span></div>
        <Link className="link-btn" to="/company-financials">{t("nav.company-financials")}</Link>
      </div>
      <div className="card-b">
        {rollups.length === 0 ? (
          <EmptyState icon={DollarSign}>{t("dash.noCosting")}</EmptyState>
        ) : (
          <>
            <div className="money-stats">
              <div>
                <span className="label">{t("dash.toCollect")}</span>
                <b>{money(receivable)}</b>
                <span className="sub">{owingCount ? tn("dash.fromProjects", owingCount) : t("dash.nothingOutstanding")}</span>
              </div>
              <div>
                <span className="label">{t("dash.safeToWithdraw")}</span>
                <b>{money(safe)}</b>
                <span className="sub">{unpriced ? tn("dash.projectsHeld", unpriced) : t("dash.afterReserves")}</span>
              </div>
              <div>
                <span className="label">{t("dash.customerCredits")}</span>
                <b>{money(credits)}</b>
                <span className="sub">{credits > 0 ? t("dash.paidAbove") : t("dash.none")}</span>
              </div>
            </div>
            {belowMargin.length > 0 ? (
              <>
                <div className="day-section">{t("dash.belowMargin")}</div>
                {belowMargin.map(r => (
                  <Link className="day-row" key={r.job.id} to={`/jobs/${r.job.id}/financials`}>
                    <span className="day-row-main"><b>{r.job.title}</b><span className="sub">{t("dash.forecastProfit", { value: money(r.forecastProfitValue) })}</span></span>
                    <span className="pill pill-danger">{r.forecastMarginValue.toFixed(1)}% / {r.minimumMarginPct}%</span>
                  </Link>
                ))}
              </>
            ) : priced.length > 0 && <p className="sub" style={{ marginTop: 12 }}>{t("dash.allAboveMargin")}</p>}
          </>
        )}
      </div>
    </section>
  );
}

// Who did what, from audit_log (now also covering leads — migration 09).
function ActivityCard() {
  const { items } = useActivityFeed(ACTIVITY_SHOWN);
  const { t, locale } = useT();
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="card-h">
        <h3>{t("dash.activity")}</h3>
        <Link className="link-btn" to="/audit-log">{t("dash.fullAuditLog")}</Link>
      </div>
      <div className="card-b">
        {items.length ? items.map(({ row, actor, text }) => (
          <div className="activity-row" key={row.id}>
            <span><b>{actor}</b> {text}</span>
            <span className="sub" style={{ whiteSpace: "nowrap" }}>{activityWhen(row.created_at, new Date(), locale)}</span>
          </div>
        )) : <EmptyState icon={History}>{t("dash.noActivity")}</EmptyState>}
      </div>
    </section>
  );
}
