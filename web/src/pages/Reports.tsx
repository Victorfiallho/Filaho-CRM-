import { Award, BarChart3, DollarSign, Megaphone, TrendingUp, Users } from "lucide-react";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import { useCustomers, useImportsHistory, useIntegrationSettings, useJobs, useLeads, useMetaAdsInsights } from "../data/hooks";
import { money } from "../domain/format";
import { isWonStage } from "../domain/pipelineStages";
import { useCompany } from "../state/CompanyContext";

// Ported verbatim from app.js (metrics, renderReports), then extended with a
// Meta Ads "Ad performance" section fed by scripts/sync-meta-ads.mjs's daily
// Marketing API pull (see data/metaAds.ts) — spend/impressions/clicks only,
// no lead creation, matching what was actually asked for.
export default function Reports() {
  const { activeCompanyId, stages } = useCompany();
  const { data: customers = [], isLoading: customersLoading } = useCustomers(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: imports = [], isLoading: importsLoading } = useImportsHistory(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { data: adInsights = [] } = useMetaAdsInsights(activeCompanyId);

  if (customersLoading || leadsLoading || jobsLoading || importsLoading) return <PageSkeleton kpis={4} cards={2} />;

  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const jobValue = jobs.reduce((t, j) => t + Number(j.estimated_value || 0), 0);
  const byService: Record<string, number> = {};
  leads.forEach(l => {
    const key = l.service_type || "Unassigned";
    byService[key] = (byService[key] || 0) + Number(l.value || 0);
  });

  const adSpend = adInsights.reduce((t, r) => t + Number(r.spend || 0), 0);
  const adImpressions = adInsights.reduce((t, r) => t + Number(r.impressions || 0), 0);
  const adClicks = adInsights.reduce((t, r) => t + Number(r.clicks || 0), 0);
  const adCpc = adClicks ? adSpend / adClicks : 0;
  const byCampaign: Record<string, { spend: number; clicks: number; impressions: number }> = {};
  adInsights.forEach(r => {
    const key = r.campaign_name || r.campaign_id;
    const entry = byCampaign[key] || { spend: 0, clicks: 0, impressions: 0 };
    entry.spend += Number(r.spend || 0);
    entry.clicks += Number(r.clicks || 0);
    entry.impressions += Number(r.impressions || 0);
    byCampaign[key] = entry;
  });

  return (
    <>
      <div className="grid kpis">
        <KpiCard icon={DollarSign} label="Estimated job revenue" value={money(jobValue)} hint="from jobs/projects" />
        <KpiCard icon={Award} label="Won leads" value={won.length} hint="closed pipeline" />
        <KpiCard icon={Users} label="Client count" value={customers.length} hint="current company" />
        <KpiCard icon={TrendingUp} label="Imports" value={imports.length} hint="CSV history" />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Revenue by service</h3></div>
        <div className="card-b">
          {Object.entries(byService).length
            ? Object.entries(byService).map(([k, v]) => <p key={k}><b>{k}</b> <span className="muted">{money(v)}</span></p>)
            : <div className="empty"><BarChart3 />No revenue yet</div>}
        </div>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Ad performance</h3><span className="sub">Meta Ads, last 30 days</span></div>
        <div className="card-b">
          {!settings?.meta_ads.enabled ? (
            <div className="empty"><Megaphone />Meta Ads not enabled yet — set it up on Integrations.</div>
          ) : adInsights.length === 0 ? (
            <div className="empty"><Megaphone />No ad data synced yet — the daily sync runs once an ad account id and access token are configured.</div>
          ) : (
            <>
              <div className="grid three" style={{ marginBottom: 14 }}>
                <KpiCard icon={DollarSign} label="Ad spend" value={money(adSpend)} hint="last 30 days" />
                <KpiCard icon={TrendingUp} label="Clicks" value={adClicks} hint={`${adImpressions.toLocaleString()} impressions`} />
                <KpiCard icon={Megaphone} label="Avg. CPC" value={money(adCpc)} hint="cost per click" />
              </div>
              {Object.entries(byCampaign).map(([name, v]) => (
                <p key={name}><b>{name}</b> <span className="muted">{money(v.spend)} · {v.clicks} clicks · {v.impressions.toLocaleString()} impressions</span></p>
              ))}
            </>
          )}
        </div>
      </section>
    </>
  );
}
