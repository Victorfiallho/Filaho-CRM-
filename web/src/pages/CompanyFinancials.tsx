import { AlertTriangle, Briefcase, Layers, Receipt, Store } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import MeterRow from "../components/MeterRow";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import {
  useCompanyChangeOrders,
  useCompanyCostLineItems,
  useCompanyProfitReleases,
  useCompanyProjectFinancials,
  useCompanyTransactions,
  useFinanceSettings,
  useIsOwner,
  useJobs,
  useVendors
} from "../data/hooks";
import { sumCashPaid, sumCommittedUnpaid, type HealthStatus } from "../domain/costing";
import { rollupCompanyProjects } from "../domain/projectRollup";
import { formatDay, groupBy, money } from "../domain/format";
import { TONES, type Tone } from "../domain/visual";
import { useT } from "../i18n/I18nContext";
import { en, type MessageKey } from "../i18n/messages";
import { useCompany } from "../state/CompanyContext";

const OWNER_DRAW_TYPES = ["owner_draw"];
const PAYROLL_TYPES = ["labor_payment", "subcontractor_payment", "employee_payment", "owner_labor_payment"];
// Tones in a fixed order, never by rank, so a row keeps its color.
const SERIES_TONES = TONES.filter(t => t !== "slate");

export default function CompanyFinancials() {
  const { activeCompanyId } = useCompany();
  const { t, tn, locale } = useT();
  const navigate = useNavigate();
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: settings, isLoading: settingsLoading } = useFinanceSettings(activeCompanyId);
  const { data: allFinancials = [], isLoading: pfLoading } = useCompanyProjectFinancials(activeCompanyId);
  const { data: allItems = [], isLoading: itemsLoading } = useCompanyCostLineItems(activeCompanyId);
  const { data: allChangeOrders = [], isLoading: coLoading } = useCompanyChangeOrders(activeCompanyId);
  const { data: allTransactions = [], isLoading: txnLoading } = useCompanyTransactions(activeCompanyId);
  const { data: allReleases = [], isLoading: releasesLoading } = useCompanyProfitReleases(activeCompanyId);
  const { data: vendors = [] } = useVendors(activeCompanyId);

  const [days, setDays] = useState(90);

  const loading = ownerLoading || jobsLoading || settingsLoading || pfLoading || itemsLoading || coLoading || txnLoading || releasesLoading;
  if (loading) return <PageSkeleton kpis={8} rows={[5, 5]} />;
  if (!isOwner) return <Navigate to="/dashboard" replace />;

  const defaultMinMargin = settings?.default_minimum_margin_pct ?? 35;
  const defaultContingency = settings?.default_contingency_pct ?? 10;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const confirmedInRange = allTransactions.filter(tx => tx.status === "confirmed" && tx.transaction_date >= cutoff);

  const rollups = rollupCompanyProjects({
    jobs, financials: allFinancials, items: allItems, changeOrders: allChangeOrders,
    transactions: allTransactions, releases: allReleases, defaultMinMargin, defaultContingency
  });

  const contractedRevenue = rollups.reduce((sum, r) => sum + r.revenue, 0);
  const receivedRevenue = rollups.reduce((sum, r) => sum + r.paymentsReceived, 0);
  const accountsReceivable = Math.max(0, contractedRevenue - receivedRevenue);
  const costsPaid = sumCashPaid(allItems);
  const costsCommitted = sumCommittedUnpaid(allItems);
  // Projects with no cost items would count their whole contract as profit:
  // left out of the total and mentioned in the hint.
  const pricedRollups = rollups.filter(r => r.hasCostData);
  const unpricedCount = rollups.length - pricedRollups.length;
  const forecastProfitTotal = pricedRollups.reduce((sum, r) => sum + r.forecastProfitValue, 0);
  const profitReleased = allReleases.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const cashReserved = rollups.reduce((sum, r) => sum + r.requiredReserve, 0);
  const cashFree = rollups.reduce((sum, r) => sum + r.safeWithdraw, 0);

  const ownerDraws = confirmedInRange.filter(tx => OWNER_DRAW_TYPES.includes(tx.transaction_type)).reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const payroll = confirmedInRange.filter(tx => PAYROLL_TYPES.includes(tx.transaction_type)).reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const vendorSpend = groupBy(allItems.filter(i => i.vendor_id), i => i.vendor_id!);
  const vendorRows = Object.entries(vendorSpend)
    .map(([vendorId, items]) => ({ name: vendors.find(v => v.id === vendorId)?.canonical_name || t("fin.unknownVendor"), total: items.reduce((sum, i) => sum + Number(i.net_cost || 0) + Number(i.internal_cost || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const maxVendorSpend = Math.max(1, ...vendorRows.map(v => v.total));

  const categorySpend = groupBy(allItems, i => i.category);
  const categoryRows = Object.entries(categorySpend)
    .map(([category, items]) => ({ name: `cat.${category}` in en ? t(`cat.${category}` as MessageKey) : category, total: items.reduce((sum, i) => sum + Number(i.net_cost || 0) + Number(i.internal_cost || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const maxCategorySpend = Math.max(1, ...categoryRows.map(c => c.total));

  const belowPolicy = pricedRollups.filter(r => r.forecastMarginValue < r.minimumMarginPct);
  const periodLabel = t(`fin.period.${days}` as MessageKey).toLowerCase();
  const healthTone: Record<HealthStatus, Tone> = { green: "green", yellow: "amber", red: "rose", gray: "slate" };
  const typeLabel = (type: string) => (`txn.${type}` in en ? t(`txn.${type}` as MessageKey) : type);
  const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

  return (
    <div className="company-financials">
      <div className="page-toolbar">
        <div className="pill-select">
          <Select
            value={String(days)}
            onChange={v => setDays(Number(v))}
            aria-label={t("fin.period.90")}
            options={["30", "90", "365"].map(d => ({ value: d, label: t(`fin.period.${d}` as MessageKey) }))}
          />
        </div>
      </div>

      <KpiStrip items={[
        { label: t("fin.contracted"), value: money(contractedRevenue), hint: tn("fin.contractedHint", rollups.length), tone: "blue" },
        { label: t("fin.received"), value: money(receivedRevenue), hint: t("fin.receivedHint"), tone: "green" },
        { label: t("fin.receivable"), value: money(accountsReceivable), hint: t("fin.receivableHint"), tone: "amber" },
        { label: t("fin.forecastProfit"), value: money(forecastProfitTotal), hint: unpricedCount ? tn("fin.forecastExcludes", unpricedCount) : t("fin.forecastHint"), tone: "purple" },
        { label: t("fin.cashFree"), value: money(cashFree), hint: t("fin.cashFreeHint"), tone: "teal" }
      ]} />

      <details className="card more-metrics" style={{ marginTop: 16 }}>
        <summary>{t("fin.moreMetrics")}</summary>
        <div className="mini-stats six">
          <div><span className="label">{t("fin.costsPaid")}</span><b>{money(costsPaid)}</b><span className="sub">{t("fin.costsPaidHint")}</span></div>
          <div><span className="label">{t("fin.costsCommitted")}</span><b>{money(costsCommitted)}</b><span className="sub">{t("fin.costsCommittedHint")}</span></div>
          <div><span className="label">{t("fin.profitReleased")}</span><b>{money(profitReleased)}</b><span className="sub">{t("fin.profitReleasedHint")}</span></div>
          <div><span className="label">{t("fin.cashReserved")}</span><b>{money(cashReserved)}</b><span className="sub">{t("fin.cashReservedHint")}</span></div>
          <div><span className="label">{t("fin.ownerDraws")}</span><b>{money(ownerDraws)}</b><span className="sub">{t("fin.inPeriod", { period: periodLabel })}</span></div>
          <div><span className="label">{t("fin.payroll")}</span><b>{money(payroll)}</b><span className="sub">{t("fin.inPeriod", { period: periodLabel })}</span></div>
        </div>
      </details>

      <div className="grid two" style={{ marginTop: 20 }}>
        <section className="card">
          <div className="card-h"><h3>{t("fin.byVendor")}</h3></div>
          <div className="card-b">
            {vendorRows.length === 0 && <EmptyState icon={Store}>{t("fin.noVendor")}</EmptyState>}
            {vendorRows.map((v, i) => <MeterRow key={v.name} label={v.name} value={v.total} max={maxVendorSpend} tone={SERIES_TONES[i % SERIES_TONES.length]} valueLabel={money(v.total)} ariaLabel={`${v.name}: ${money(v.total)}`} />)}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>{t("fin.byCategory")}</h3></div>
          <div className="card-b">
            {categoryRows.length === 0 && <EmptyState icon={Layers}>{t("fin.noCategory")}</EmptyState>}
            {categoryRows.map((c, i) => <MeterRow key={c.name} label={c.name} value={c.total} max={maxCategorySpend} tone={SERIES_TONES[i % SERIES_TONES.length]} valueLabel={money(c.total)} ariaLabel={`${c.name}: ${money(c.total)}`} />)}
          </div>
        </section>
      </div>

      {belowPolicy.length > 0 && (
        <section className="card attention-card" style={{ marginTop: 20 }}>
          <div className="card-h"><h3><AlertTriangle aria-hidden="true" />{t("fin.belowPolicy")}</h3></div>
          <div className="card-b">
            {belowPolicy.map(r => (
              <div key={r.job.id} className="attention-row">
                <span><b>{r.job.title}</b>: {t("fin.belowLine", { margin: r.forecastMarginValue.toFixed(1), min: r.minimumMarginPct })}</span>
                <Link className="action-pill" to={`/jobs/${r.job.id}/financials`}>{t("common.review")}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="card-h"><h3>{t("fin.byProject")}</h3></div>
        {rollups.length === 0 ? (
          <div className="card-b"><EmptyState icon={Briefcase}>{t("fin.noProjects")}</EmptyState></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>{t("fin.col.project")}</th><th className="num">{t("fin.col.contract")}</th><th className="num">{t("fin.col.profit")}</th><th className="num">{t("fin.col.margin")}</th><th>{t("fin.col.health")}</th></tr>
              </thead>
              <tbody>
                {rollups.map(r => (
                  <tr key={r.job.id} className="row-clickable" onClick={() => navigate(`/jobs/${r.job.id}/financials`)}>
                    <td><b className="cell-strong">{r.job.title}</b></td>
                    <td className="num">{money(r.revenue)}</td>
                    <td className="num">{r.hasCostData ? money(r.forecastProfitValue) : "—"}</td>
                    <td className="num">{r.hasCostData ? `${r.forecastMarginValue.toFixed(1)}%` : <span className="cell-missing">{t("fin.noCostsYet")}</span>}</td>
                    <td><span className={`badge-tone tone-${healthTone[r.healthStatus]}`}>{t(`health.${r.healthStatus}` as MessageKey)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="card-h"><div><h3>{t("fin.recent")}</h3><span className="sub">{capitalize(periodLabel)}</span></div></div>
        {confirmedInRange.length === 0 ? (
          <div className="card-b"><EmptyState icon={Receipt}>{t("fin.noTransactions")}</EmptyState></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t("fin.col.date")}</th><th>{t("fin.col.type")}</th><th>{t("fin.col.project")}</th><th className="num">{t("fin.col.amount")}</th><th>{t("fin.col.status")}</th></tr></thead>
              <tbody>
                {confirmedInRange.slice(0, 20).map(tx => (
                  <tr key={tx.id}>
                    <td>{formatDay(tx.transaction_date, undefined, locale)}</td>
                    <td>{capitalize(typeLabel(tx.transaction_type))}</td>
                    <td>{jobs.find(j => j.id === tx.job_id)?.title || "—"}</td>
                    <td className="num">{money(tx.amount)}</td>
                    <td><span className={`pill status-${tx.status === "confirmed" ? "active" : "draft"}`}>{t(`txnStatus.${tx.status}` as MessageKey)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
