import { Award, BarChart3, DollarSign, Megaphone, Percent, Target, TrendingUp, Users } from "lucide-react";
import { useState } from "react";
import BarRow from "../components/BarRow";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import {
  useCampaignRoi, useCustomers, useFunnelSummary, useImportsHistory,
  useIntegrationSettings, useJobs, useLeads, useMetaAdsInsights
} from "../data/hooks";
import { money } from "../domain/format";
import { isWonStage } from "../domain/pipelineStages";
import { useCompany } from "../state/CompanyContext";

const ROI_PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" }
];

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
  const { data: funnel = [] } = useFunnelSummary(activeCompanyId);
  const [roiPeriod, setRoiPeriod] = useState("90");
  const roiDateTo = new Date().toISOString();
  const roiDateFrom = new Date(Date.now() - Number(roiPeriod) * 86400000).toISOString();
  const { data: campaignRoi = [] } = useCampaignRoi(activeCompanyId, roiDateFrom, roiDateTo);

  if (customersLoading || leadsLoading || jobsLoading || importsLoading) return <PageSkeleton kpis={4} cards={2} />;

  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const jobValue = jobs.reduce((t, j) => t + Number(j.estimated_value || 0), 0);
  const byService: Record<string, number> = {};
  leads.forEach(l => {
    const key = l.service_type || "Unassigned";
    byService[key] = (byService[key] || 0) + Number(l.value || 0);
  });
  const serviceEntries = Object.entries(byService);
  const maxServiceRevenue = Math.max(1, ...serviceEntries.map(([, v]) => v));

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
  const campaignEntries = Object.entries(byCampaign);
  // Spend is the one metric driving bar width — clicks/impressions ride
  // along as plain text in valueLabel instead of a second bar/axis, since a
  // campaign's spend and click count live on entirely different scales.
  const maxCampaignSpend = Math.max(1, ...campaignEntries.map(([, v]) => v.spend));

  return (
    <div className="view-enter">
      <div className="grid kpis">
        <KpiCard icon={DollarSign} label="Estimated job revenue" value={money(jobValue)} hint="from jobs/projects" />
        <KpiCard icon={Award} label="Won leads" value={won.length} hint="closed pipeline" />
        <KpiCard icon={Users} label="Client count" value={customers.length} hint="current company" />
        <KpiCard icon={TrendingUp} label="Imports" value={imports.length} hint="CSV history" />
      </div>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Revenue by service</h3></div>
        <div className="card-b">
          {serviceEntries.length
            ? serviceEntries.map(([k, v]) => (
              <BarRow key={k} label={k} magnitude={v} max={maxServiceRevenue} valueLabel={<span className="muted">{money(v)}</span>} />
            ))
            : <div className="empty"><BarChart3 />No revenue yet</div>}
        </div>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Funnel</h3><span className="sub">Conversion, velocity &amp; weighted forecast by stage — all time</span></div>
        <div className="card-b">
          {funnel.length === 0 ? (
            <div className="empty"><Target />No pipeline stages yet</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stage</th><th>Leads</th><th>Conversion</th><th>Avg. days in stage</th><th>Value</th><th>Weighted forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.map(f => (
                    <tr key={f.stage_id}>
                      <td>{f.stage_name}</td>
                      <td>{f.lead_count}</td>
                      <td>{Math.round(f.conversion_rate * 100)}%</td>
                      <td>{f.avg_days_in_stage != null ? `${Math.round(f.avg_days_in_stage)}d` : "—"}</td>
                      <td>{money(f.total_value)}</td>
                      <td>{money(f.weighted_forecast)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <div>
            <h3>ROI by campaign</h3>
            <span className="sub">Ad spend vs. attributed job revenue</span>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <Select value={roiPeriod} onChange={setRoiPeriod} options={ROI_PERIODS} />
          </div>
        </div>
        <div className="card-b">
          {!settings?.meta_ads.enabled ? (
            <div className="empty"><Percent />Meta Ads not enabled yet — set it up on Integrations.</div>
          ) : campaignRoi.length === 0 ? (
            <div className="empty"><Percent />No campaign data for this period yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Campaign</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>CPL</th><th>Leads</th></tr>
                </thead>
                <tbody>
                  {campaignRoi.map(c => (
                    <tr key={c.campaign_id ?? "unattributed"}>
                      <td>{c.campaign_name || c.campaign_id || "—"}</td>
                      <td>{money(c.spend)}</td>
                      <td>{money(c.revenue)}</td>
                      <td>{c.spend > 0 ? `${c.roas.toFixed(2)}x` : "—"}</td>
                      <td>{c.leads_count > 0 ? money(c.cpl) : "—"}</td>
                      <td>{c.leads_count || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              {campaignEntries.map(([name, v]) => (
                <BarRow
                  key={name}
                  label={name}
                  magnitude={v.spend}
                  max={maxCampaignSpend}
                  valueLabel={<span className="muted">{money(v.spend)} · {v.clicks} clicks · {v.impressions.toLocaleString()} impressions</span>}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
