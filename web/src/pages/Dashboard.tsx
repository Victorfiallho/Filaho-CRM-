import { Briefcase, DollarSign, Target, Users } from "lucide-react";
import KpiCard from "../components/KpiCard";
import { useCustomers, useJobs, useLeads } from "../data/hooks";
import { INTEGRATION_PLACEHOLDERS } from "../domain/constants";
import { money, titleize } from "../domain/format";
import { isOpenStage, isWonStage } from "../domain/pipelineStages";
import { useCompany } from "../state/CompanyContext";

// Ported verbatim from app.js (metrics, renderDashboard, stageBar).
export default function Dashboard() {
  const { activeCompanyId, stages } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);

  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const openLeads = leads.filter(l => isOpenStage(l.stage_id, stages));
  const pipelineValue = openLeads.reduce((t, l) => t + Number(l.value || 0), 0);
  const integrationEntries = Object.entries(INTEGRATION_PLACEHOLDERS);
  const connectedCount = integrationEntries.filter(([, v]) => v.status === "connected").length;

  return (
    <>
      <div className="grid kpis">
        <KpiCard icon={Users} label="Clients" value={customers.length} hint="active company records" />
        <KpiCard icon={Target} label="Open leads" value={openLeads.length} hint={`${won.length} won`} />
        <KpiCard icon={Briefcase} label="Jobs/projects" value={jobs.length} hint="scheduled and active" />
        <KpiCard icon={DollarSign} label="Pipeline" value={money(pipelineValue)} hint="estimated value" />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="card">
          <div className="card-h"><h3>Pipeline by stage</h3><span className="sub">Company only</span></div>
          <div className="card-b">
            {stages.map(stage => {
              const count = leads.filter(l => l.stage_id === stage.id).length;
              return (
                <div key={stage.id} style={{ marginBottom: 12 }}>
                  <div className="between"><b>{stage.name}</b><span className="pill">{count}</span></div>
                  <div style={{ height: 8, background: "#eef2f6", borderRadius: 999, marginTop: 7 }}>
                    <div style={{ width: `${Math.min(100, count * 18)}%`, height: 8, background: stage.color || undefined, borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Integrations status</h3><span className="sub">{connectedCount} of {integrationEntries.length} connected</span></div>
          <div className="card-b">
            {integrationEntries.map(([k, v]) => (
              <p key={k}><span className={`pill status-${v.status}`}>{v.status}</span> {titleize(k)}</p>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
