import KpiCard from "../components/KpiCard";
import { useCustomers, useImportsHistory, useJobs, useLeads } from "../data/hooks";
import { money } from "../domain/format";
import { isWonStage } from "../domain/pipelineStages";
import { useCompany } from "../state/CompanyContext";

// Ported verbatim from app.js (metrics, renderReports).
export default function Reports() {
  const { activeCompanyId, stages } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: imports = [] } = useImportsHistory(activeCompanyId);

  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const jobValue = jobs.reduce((t, j) => t + Number(j.estimated_value || 0), 0);
  const byService: Record<string, number> = {};
  leads.forEach(l => {
    const key = l.service_type || "Unassigned";
    byService[key] = (byService[key] || 0) + Number(l.value || 0);
  });

  return (
    <>
      <div className="grid kpis">
        <KpiCard label="Estimated job revenue" value={money(jobValue)} hint="from jobs/projects" />
        <KpiCard label="Won leads" value={won.length} hint="closed pipeline" />
        <KpiCard label="Client count" value={customers.length} hint="current company" />
        <KpiCard label="Imports" value={imports.length} hint="CSV history" />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Revenue by service</h3><span className="sub">MVP report</span></div>
        <div className="card-b">
          {Object.entries(byService).length
            ? Object.entries(byService).map(([k, v]) => <p key={k}><b>{k}</b> <span className="muted">{money(v)}</span></p>)
            : <div className="empty">No revenue yet</div>}
        </div>
      </section>
    </>
  );
}
