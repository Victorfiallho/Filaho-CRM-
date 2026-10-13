import { BarChart3, Megaphone, Percent, Target } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import MeterRow from "../components/MeterRow";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import {
  useCampaignRoi, useCustomers, useFunnelSummary, useImportsHistory,
  useIntegrationSettings, useJobs, useLeads, useMetaAdsInsights
} from "../data/hooks";
import { money } from "../domain/format";
import { isWonStage } from "../domain/pipelineStages";
import { lostReasonCounts } from "../domain/followUp";
import { weeklyTrend } from "../domain/trend";
import { stageTone, TONES } from "../domain/visual";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { useCompany } from "../state/CompanyContext";

const ROI_PERIODS = ["30", "90", "365"] as const;
// Categorical tones in a fixed order (never cycled by rank): service and
// campaign rows keep their tone as long as their position doesn't change.
const SERIES_TONES = TONES.filter(t => t !== "slate");

// Ported from app.js (metrics, renderReports), then extended with a Meta Ads
// "Ad performance" section fed by scripts/sync-meta-ads.mjs's daily
// Marketing API pull (see data/metaAds.ts) — spend/impressions/clicks only.
export default function Reports() {
  const { activeCompanyId, stages } = useCompany();
  const { t, tn, locale } = useT();
  const { data: customers = [], isLoading: customersLoading } = useCustomers(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: imports = [], isLoading: importsLoading } = useImportsHistory(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { data: adInsights = [] } = useMetaAdsInsights(activeCompanyId);
  const { data: funnel = [] } = useFunnelSummary(activeCompanyId);
  const [roiPeriod, setRoiPeriod] = useState<string>("90");
  // Memoized: useCampaignRoi() puts both dates in its query key, and a fresh
  // `new Date()` per render meant a "new" query (and a fetch) every render —
  // an infinite request loop on rpc/get_campaign_roi while this page was open.
  const [roiDateFrom, roiDateTo] = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(roiPeriod) * 86400000);
    return [from.toISOString(), to.toISOString()];
  }, [roiPeriod]);
  const { data: campaignRoi = [] } = useCampaignRoi(activeCompanyId, roiDateFrom, roiDateTo);

  if (customersLoading || leadsLoading || jobsLoading || importsLoading) return <PageSkeleton kpis={4} cards={2} />;

  const num = (n: number) => n.toLocaleString(locale);
  const won = leads.filter(l => isWonStage(l.stage_id, stages));
  const lostReasons = lostReasonCounts(leads, stages);
  const maxLostReason = Math.max(1, ...lostReasons.map(r => r.count));
  const jobValue = jobs.reduce((sum, j) => sum + Number(j.estimated_value || 0), 0);
  const byService: Record<string, number> = {};
  leads.forEach(l => {
    const key = l.service_type || "";
    byService[key] = (byService[key] || 0) + Number(l.value || 0);
  });
  const serviceEntries = Object.entries(byService).sort((a, b) => b[1] - a[1]);
  const maxServiceRevenue = Math.max(1, ...serviceEntries.map(([, v]) => v));

  const adSpend = adInsights.reduce((sum, r) => sum + Number(r.spend || 0), 0);
  const adImpressions = adInsights.reduce((sum, r) => sum + Number(r.impressions || 0), 0);
  const adClicks = adInsights.reduce((sum, r) => sum + Number(r.clicks || 0), 0);
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
  // Spend drives bar length; clicks/impressions ride along as text instead
  // of a second bar on a different scale.
  const maxCampaignSpend = Math.max(1, ...campaignEntries.map(([, v]) => v.spend));
  const metaOn = Boolean(settings?.meta_ads.enabled);

  return (
    <div className="view-enter">
      <KpiStrip items={[
        { label: t("rep.kpi.revenue"), value: money(jobValue), hint: t("rep.kpi.revenueHint"), tone: "green", series: weeklyTrend(jobs, j => j.created_at, j => Number(j.estimated_value || 0), 10).map(p => p.value) },
        { label: t("rep.kpi.won"), value: won.length, hint: t("rep.kpi.wonHint"), tone: "blue", series: weeklyTrend(won, l => l.updated_at, () => 1, 10).map(p => p.value) },
        { label: t("rep.kpi.clients"), value: customers.length, hint: t("rep.kpi.clientsHint"), tone: "amber", series: weeklyTrend(customers, c => c.created_at, () => 1, 10).map(p => p.value) },
        { label: t("rep.kpi.imports"), value: imports.length, hint: t("rep.kpi.importsHint"), tone: "purple" }
      ]} />

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <div className="card-h"><div><h3>{t("rep.revenueByService")}</h3><span className="sub">{t("rep.revenueByServiceSub")}</span></div></div>
          <div className="card-b">
            {serviceEntries.length
              ? serviceEntries.map(([name, v], i) => {
                const label = name || t("rep.unassigned");
                return <MeterRow key={name} label={label} value={v} max={maxServiceRevenue} tone={SERIES_TONES[i % SERIES_TONES.length]} valueLabel={money(v)} ariaLabel={`${label}: ${money(v)}`} />;
              })
              : <EmptyState icon={BarChart3}>{t("rep.noRevenue")}</EmptyState>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><div><h3>{t("rep.lostReasons")}</h3><span className="sub">{t("rep.lostReasonsSub")}</span></div></div>
          <div className="card-b">
            {lostReasons.length
              ? lostReasons.map(r => {
                const label = r.reason === "Not recorded" ? t("rep.notRecorded") : r.reason;
                return <MeterRow key={r.reason} label={label} value={r.count} max={maxLostReason} tone="rose" valueLabel={tn("rep.leadsCount", r.count)} ariaLabel={`${label}: ${tn("rep.leadsCount", r.count)}`} />;
              })
              : <EmptyState icon={Target}>{t("rep.noLost")}</EmptyState>}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-h"><div><h3>{t("rep.funnel")}</h3><span className="sub">{t("rep.funnelSub")}</span></div></div>
        <div className="card-b">
          {funnel.length === 0 ? (
            <EmptyState icon={Target}>{t("rep.noStages")}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("rep.col.stage")}</th><th className="num">{t("rep.col.leads")}</th><th>{t("rep.col.conversion")}</th>
                    <th className="num">{t("rep.col.avgDays")}</th><th className="num">{t("rep.col.value")}</th><th className="num">{t("rep.col.forecast")}</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.map(f => {
                    const index = stages.findIndex(s => s.id === f.stage_id);
                    const tone = stageTone(stages[index] || { id: f.stage_id }, Math.max(0, index));
                    const pct = Math.round(f.conversion_rate * 100);
                    return (
                      <tr key={f.stage_id}>
                        <td><span className={`stage-meter-name tone-${tone}`}>{f.stage_name}</span></td>
                        <td className="num">{num(f.lead_count)}</td>
                        <td>
                          <span className="conv-cell">
                            <span className={`conv-bar tone-${tone}`}><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
                            {pct}%
                          </span>
                        </td>
                        <td className="num">{f.avg_days_in_stage != null ? `${Math.round(f.avg_days_in_stage)}d` : "—"}</td>
                        <td className="num">{money(f.total_value)}</td>
                        <td className="num">{money(f.weighted_forecast)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <div className="card-h">
            <div><h3>{t("rep.roi")}</h3><span className="sub">{t("rep.roiSub")}</span></div>
            <div className="pill-select">
              <Select value={roiPeriod} onChange={setRoiPeriod} options={ROI_PERIODS.map(p => ({ value: p, label: t(`rep.period.${p}` as MessageKey) }))} />
            </div>
          </div>
          <div className="card-b">
            {!metaOn ? (
              <EmptyState icon={Percent}>{t("rep.metaOff")}</EmptyState>
            ) : campaignRoi.length === 0 ? (
              <EmptyState icon={Percent}>{t("rep.noCampaigns")}</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("rep.col.campaign")}</th><th className="num">{t("rep.col.spend")}</th><th className="num">{t("rep.col.revenue")}</th>
                      <th className="num">{t("rep.col.roas")}</th><th className="num">{t("rep.col.cpl")}</th><th className="num">{t("rep.col.leads")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRoi.map(c => (
                      <tr key={c.campaign_id ?? "unattributed"}>
                        <td>{c.campaign_name || c.campaign_id || "—"}</td>
                        <td className="num">{money(c.spend)}</td>
                        <td className="num">{money(c.revenue)}</td>
                        <td className="num">{c.spend > 0 ? `${c.roas.toFixed(2)}x` : "—"}</td>
                        <td className="num">{c.leads_count > 0 ? money(c.cpl) : "—"}</td>
                        <td className="num">{c.leads_count || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-h"><div><h3>{t("rep.adPerformance")}</h3><span className="sub">{t("rep.adPerformanceSub")}</span></div></div>
          <div className="card-b">
            {!metaOn ? (
              <EmptyState icon={Megaphone}>{t("rep.metaOff")}</EmptyState>
            ) : adInsights.length === 0 ? (
              <EmptyState icon={Megaphone}>{t("rep.noAdData")}</EmptyState>
            ) : (
              <>
                <div className="mini-stats">
                  <div><span className="label">{t("rep.adSpend")}</span><b>{money(adSpend)}</b><span className="sub">{t("rep.last30")}</span></div>
                  <div><span className="label">{t("rep.clicks")}</span><b>{num(adClicks)}</b><span className="sub">{t("rep.impressions", { count: num(adImpressions) })}</span></div>
                  <div><span className="label">{t("rep.cpc")}</span><b>{money(adCpc)}</b><span className="sub">{t("rep.cpcHint")}</span></div>
                </div>
                {campaignEntries.map(([name, v], i) => (
                  <MeterRow
                    key={name}
                    label={name}
                    value={v.spend}
                    max={maxCampaignSpend}
                    tone={SERIES_TONES[i % SERIES_TONES.length]}
                    valueLabel={money(v.spend)}
                    ariaLabel={t("rep.campaignLine", { spend: money(v.spend), clicks: num(v.clicks), impressions: num(v.impressions) })}
                  />
                ))}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
