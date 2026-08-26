import { AlertCircle, Briefcase, Calendar, DollarSign, Target, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import { useCustomers, useIntegrationSettings, useJobs, useLeads } from "../data/hooks";
import { money } from "../domain/format";
import { isOpenStage, isWonStage } from "../domain/pipelineStages";
import { useCompany } from "../state/CompanyContext";
import type { Customer, Job } from "../domain/types";

function activityWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Ported verbatim from app.js (metrics, renderDashboard, stageBar), then
// extended with an Upcoming jobs table, a real (not hardcoded) integrations
// summary, and honest "Needs attention"/"Recent activity" panels — see the
// per-panel comments below for exactly what's real data vs a scoped-down
// substitute for something the schema can't actually answer yet.
export default function Dashboard() {
  const { activeCompanyId, stages } = useCompany();
  const { data: customers = [], isLoading: customersLoading } = useCustomers(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const navigate = useNavigate();

  if (customersLoading || leadsLoading || jobsLoading) return <PageSkeleton kpis={4} cards={4} />;

  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const openLeads = leads.filter(l => isOpenStage(l.stage_id, stages));
  const pipelineValue = openLeads.reduce((t, l) => t + Number(l.value || 0), 0);
  const activeJobs = jobs.filter(j => j.status !== "complete");
  const scheduledJobs = jobs.filter(j => j.scheduled_date);

  const upcoming = [...jobs].filter(j => j.scheduled_date).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).slice(0, 5);

  // Real, derivable from the actual schema — not the "Estimate sent" /
  // "follow-up date" style alerts from the reference mockup, since leads
  // don't track an estimate-sent event or a follow-up date at all.
  const unscheduledJobs = jobs.filter(j => !j.scheduled_date && j.status !== "complete");
  const noContactLeads = leads.filter(l => !l.phone && !l.email);
  const calendarConnected = Boolean(settings?.google_calendar.enabled);
  const alerts = [
    unscheduledJobs.length > 0 && { text: `${unscheduledJobs.length} job${unscheduledJobs.length === 1 ? "" : "s"} need${unscheduledJobs.length === 1 ? "s" : ""} scheduling`, action: "Review", to: "/jobs" },
    noContactLeads.length > 0 && { text: `${noContactLeads.length} lead${noContactLeads.length === 1 ? "" : "s"} have no contact info`, action: "Review", to: "/pipeline" },
    !calendarConnected && { text: "Google Calendar not connected", action: "Connect", to: "/integrations" }
  ].filter(Boolean) as { text: string; action: string; to: string }[];

  // Not a real activity/audit log (the schema has no such table) — this is
  // the honest version of that idea: the most recently touched records,
  // generically labeled, rather than inventing specific actions ("sent",
  // "moved to Won") nothing actually recorded happening.
  const activity = [
    ...leads.map(l => ({ id: `lead_${l.id}`, text: `Lead updated: ${l.name}`, at: l.updated_at })),
    ...jobs.map((j: Job) => ({ id: `job_${j.id}`, text: `Job updated: ${j.title}`, at: j.updated_at })),
    ...customers.map((c: Customer) => ({ id: `cust_${c.id}`, text: `Client updated: ${c.name}`, at: c.updated_at }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  // Same 6 integrations app.js originally hardcoded as "planned" placeholders
  // (map_geocoding, google_calendar, google_sheets, google_drive, email_sms,
  // meta_ads) — now reading the real integration_settings row instead, so
  // toggling a service on the Integrations page actually shows up here.
  const integrationsConnected = [
    Boolean(settings?.google_maps.enabled),
    calendarConnected,
    Boolean(settings?.google_sheets.enabled),
    Boolean(settings?.google_drive.enabled),
    Boolean(settings?.email_sms.enabled),
    Boolean(settings?.meta_ads.enabled)
  ].filter(Boolean).length;

  return (
    <>
      <div className="grid kpis">
        <KpiCard icon={Users} label="Clients" value={customers.length} hint="active company records" />
        <KpiCard icon={Target} label="Open leads" value={openLeads.length} hint={`${won.length} won`} />
        <KpiCard icon={Briefcase} label="Active jobs" value={activeJobs.length} hint={`${scheduledJobs.length} scheduled`} />
        <KpiCard icon={DollarSign} label="Pipeline" value={money(pipelineValue)} hint="estimated value" />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
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
                          <td>{job.scheduled_date}</td>
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
            ) : <div className="empty"><Calendar />No scheduled jobs yet</div>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Needs attention</h3><span className="pill">{alerts.length}</span></div>
          <div className="card-b">
            {alerts.length ? alerts.map(a => (
              <div className="attention-row" key={a.text}>
                <span>{a.text}</span>
                <button className="link-btn" onClick={() => navigate(a.to)}>{a.action}</button>
              </div>
            )) : <div className="empty"><AlertCircle />All caught up</div>}
          </div>
        </section>
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-h">
            <h3>Pipeline by stage</h3>
            <button className="link-btn" onClick={() => navigate("/pipeline")}>View pipeline</button>
          </div>
          <div className="card-b">
            {stages.map(stage => {
              const count = leads.filter(l => l.stage_id === stage.id).length;
              return (
                <div key={stage.id} style={{ marginBottom: 12 }}>
                  <div className="between"><b>{stage.name}</b><span className="pill">{count}</span></div>
                  <div style={{ height: 8, background: "var(--soft)", borderRadius: 999, marginTop: 7 }}>
                    <div style={{ width: `${Math.min(100, count * 18)}%`, height: 8, background: stage.color || "var(--brand)", borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Recent activity</h3></div>
          <div className="card-b">
            {activity.length ? activity.map(item => (
              <div className="activity-row" key={item.id}>
                <span>{item.text}</span>
                <span className="sub">{activityWhen(item.at)}</span>
              </div>
            )) : <div className="empty">No activity yet</div>}
          </div>
        </section>
      </div>
      <p className="sub" style={{ marginTop: 14 }}>
        Integrations: {integrationsConnected} of 6 connected · <button className="link-btn" onClick={() => navigate("/integrations")}>Manage integrations</button>
      </p>
    </>
  );
}
