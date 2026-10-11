import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import BarRow from "../components/BarRow";
import KpiCard from "../components/KpiCard";
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
import { computeProjectFinancials, sumCashPaid, sumCommittedUnpaid, type HealthStatus } from "../domain/costing";
import { isCustomerPayment, TRANSACTION_TYPE_LABELS } from "../domain/transactions";
import { formatDay, groupBy, money, titleize } from "../domain/format";
import { useCompany } from "../state/CompanyContext";
import type { CostLineItem, Job, ProjectFinancials, Transaction } from "../domain/types";

const OWNER_DRAW_TYPES = ["owner_draw"];
const PAYROLL_TYPES = ["labor_payment", "subcontractor_payment", "employee_payment", "owner_labor_payment"];

interface ProjectRollup {
  job: Job;
  pf: ProjectFinancials;
  revenue: number;
  paymentsReceived: number;
  // False until the project has at least one cost item — its forecast
  // profit/margin are then unknown (not 100%), and it holds no free cash.
  hasCostData: boolean;
  forecastProfitValue: number;
  forecastMarginValue: number;
  requiredReserve: number;
  safeWithdraw: number;
  healthStatus: HealthStatus;
  minimumMarginPct: number;
}

// Same computeProjectFinancials the project screen uses, so a project that
// shows "$0 safe to withdraw" there can't count as free cash here.
function rollupProject(job: Job, pf: ProjectFinancials, items: CostLineItem[], approvedChangeOrdersTotal: number, transactions: Transaction[], releasedTotal: number, defaultMinMargin: number, defaultContingency: number): ProjectRollup {
  const minimumMarginPct = pf.minimum_margin_pct ?? defaultMinMargin;
  const ledgerPayments = transactions.filter(t => t.status === "confirmed" && isCustomerPayment(t.transaction_type));
  const summary = computeProjectFinancials({
    originalContractValue: Number(pf.original_contract_value || 0),
    discounts: Number(pf.discounts || 0),
    customerFees: Number(pf.customer_fees || 0),
    approvedChangeOrdersTotal,
    minimumMarginPct,
    contingencyPct: pf.contingency_pct ?? defaultContingency,
    minimumProfitUsd: pf.minimum_profit_usd,
    paymentsReceivedManual: Number(pf.payments_received_manual || 0),
    ledgerPaymentsReceived: ledgerPayments.length ? ledgerPayments.reduce((t, x) => t + Number(x.amount || 0), 0) : null,
    releasedTotal,
    items
  });

  return {
    job,
    pf,
    revenue: summary.revenue,
    paymentsReceived: summary.paymentsReceived,
    hasCostData: summary.hasCostData,
    forecastProfitValue: summary.forecastProfit,
    forecastMarginValue: summary.forecastMarginPct,
    requiredReserve: summary.requiredReserve,
    safeWithdraw: summary.safeToWithdraw,
    healthStatus: summary.health.status,
    minimumMarginPct
  };
}

export default function CompanyFinancials() {
  const { activeCompanyId, activeCompany } = useCompany();
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
  const confirmedInRange = allTransactions.filter(t => t.status === "confirmed" && t.transaction_date >= cutoff);

  const rollups: ProjectRollup[] = allFinancials
    .map(pf => {
      const job = jobs.find(j => j.id === pf.job_id);
      if (!job) return null;
      const items = allItems.filter(i => i.job_id === job.id);
      const approvedChangeOrdersTotal = allChangeOrders.filter(co => co.job_id === job.id && co.status === "approved").reduce((t, co) => t + Number(co.amount || 0), 0);
      const jobTransactions = allTransactions.filter(t => t.job_id === job.id);
      const releasedTotal = allReleases.filter(r => r.job_id === job.id).reduce((t, r) => t + Number(r.amount || 0), 0);
      return rollupProject(job, pf, items, approvedChangeOrdersTotal, jobTransactions, releasedTotal, defaultMinMargin, defaultContingency);
    })
    .filter((r): r is ProjectRollup => r !== null);

  const contractedRevenue = rollups.reduce((t, r) => t + r.revenue, 0);
  const receivedRevenue = rollups.reduce((t, r) => t + r.paymentsReceived, 0);
  const accountsReceivable = Math.max(0, contractedRevenue - receivedRevenue);
  const costsPaid = sumCashPaid(allItems);
  const costsCommitted = sumCommittedUnpaid(allItems);
  // Unpriced projects (no cost items) would add their whole contract as
  // "profit" — left out of the total and called out in the hint instead.
  const pricedRollups = rollups.filter(r => r.hasCostData);
  const unpricedCount = rollups.length - pricedRollups.length;
  const forecastProfitTotal = pricedRollups.reduce((t, r) => t + r.forecastProfitValue, 0);
  const profitReleased = allReleases.reduce((t, r) => t + Number(r.amount || 0), 0);
  const cashReserved = rollups.reduce((t, r) => t + r.requiredReserve, 0);
  const cashFree = rollups.reduce((t, r) => t + r.safeWithdraw, 0);

  const ownerDraws = confirmedInRange.filter(t => OWNER_DRAW_TYPES.includes(t.transaction_type)).reduce((t, x) => t + Number(x.amount || 0), 0);
  const payroll = confirmedInRange.filter(t => PAYROLL_TYPES.includes(t.transaction_type)).reduce((t, x) => t + Number(x.amount || 0), 0);

  const vendorSpend = groupBy(allItems.filter(i => i.vendor_id), i => i.vendor_id!);
  const vendorRows = Object.entries(vendorSpend)
    .map(([vendorId, items]) => ({ name: vendors.find(v => v.id === vendorId)?.canonical_name || "Unknown vendor", total: items.reduce((t, i) => t + Number(i.net_cost || 0) + Number(i.internal_cost || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const maxVendorSpend = Math.max(1, ...vendorRows.map(v => v.total));

  const categorySpend = groupBy(allItems, i => i.category);
  const categoryRows = Object.entries(categorySpend)
    .map(([category, items]) => ({ name: titleize(category), total: items.reduce((t, i) => t + Number(i.net_cost || 0) + Number(i.internal_cost || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const maxCategorySpend = Math.max(1, ...categoryRows.map(c => c.total));

  const belowPolicy = pricedRollups.filter(r => r.forecastMarginValue < r.minimumMarginPct);

  return (
    <div className="company-financials">
      <div className="between" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{activeCompany?.name} — Company Financials</h2>
        <div style={{ minWidth: 160 }}>
          <Select
            value={String(days)}
            onChange={v => setDays(Number(v))}
            options={[{ value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last 365 days" }]}
          />
        </div>
      </div>

      <div className="grid kpis">
        <KpiCard label="Contracted Revenue" value={money(contractedRevenue)} hint={`${rollups.length} project${rollups.length === 1 ? "" : "s"} with costing set up`} />
        <KpiCard label="Received Revenue" value={money(receivedRevenue)} hint="Confirmed customer payments (or manual fallback)" />
        <KpiCard label="Accounts Receivable" value={money(accountsReceivable)} hint="Contracted minus received" />
        <KpiCard label="Costs Paid" value={money(costsPaid)} hint="Real cash out, all projects" />
        <KpiCard label="Costs Committed" value={money(costsCommitted)} hint="Ordered/committed, not yet paid" />
        <KpiCard label="Forecast Profit" value={money(forecastProfitTotal)} hint={unpricedCount ? `Excludes ${unpricedCount} project${unpricedCount === 1 ? "" : "s"} with no cost estimates` : "Sum across all projects"} />
        <KpiCard label="Profit Released" value={money(profitReleased)} hint="All-time, all projects" />
        <KpiCard label="Cash Reserved" value={money(cashReserved)} hint="Committed + remaining + contingency" />
        <KpiCard label="Cash Free" value={money(cashFree)} hint="Safe to withdraw, summed" />
        <KpiCard label="Owner Draws" value={money(ownerDraws)} hint={`Confirmed, last ${days} days`} />
        <KpiCard label="Payroll / Labor" value={money(payroll)} hint={`Confirmed, last ${days} days`} />
      </div>

      <div className="two" style={{ marginTop: 16, display: "grid", gap: 16 }}>
        <section className="card">
          <div className="card-h"><h3>Spending by vendor</h3></div>
          <div className="card-b">
            {vendorRows.length === 0 && <p className="muted">No vendor spending recorded yet.</p>}
            {vendorRows.map(v => <BarRow key={v.name} label={v.name} magnitude={v.total} max={maxVendorSpend} valueLabel={money(v.total)} />)}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Spending by category</h3></div>
          <div className="card-b">
            {categoryRows.length === 0 && <p className="muted">No cost items recorded yet.</p>}
            {categoryRows.map(c => <BarRow key={c.name} label={c.name} magnitude={c.total} max={maxCategorySpend} valueLabel={money(c.total)} />)}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h3>Profitability by project</h3></div>
        <div className="card-b">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Contract</th><th>Forecast Profit</th><th>Forecast Margin</th><th>Health</th></tr></thead>
              <tbody>
                {rollups.map(r => (
                  <tr key={r.job.id}>
                    <td><Link to={`/jobs/${r.job.id}/financials`}>{r.job.title}</Link></td>
                    <td>{money(r.revenue)}</td>
                    <td>{r.hasCostData ? money(r.forecastProfitValue) : "—"}</td>
                    <td>{r.hasCostData ? `${r.forecastMarginValue.toFixed(1)}%` : "No costs yet"}</td>
                    <td><span className={`pill health-pill-${r.healthStatus}`}>{r.healthStatus}</span></td>
                  </tr>
                ))}
                {rollups.length === 0 && <tr><td colSpan={5} className="muted">No projects have costing set up yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {belowPolicy.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-h"><h3>Projects below minimum margin policy</h3></div>
          <div className="card-b">
            {belowPolicy.map(r => (
              <div key={r.job.id} className="attention-row">
                <span>{r.job.title} — {r.forecastMarginValue.toFixed(1)}% (min {r.minimumMarginPct}%)</span>
                <Link className="link-btn" to={`/jobs/${r.job.id}/financials`}>Review</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h3>Recent transactions ({days} days)</h3></div>
        <div className="card-b">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Project</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {confirmedInRange.slice(0, 20).map(t => (
                  <tr key={t.id}>
                    <td>{formatDay(t.transaction_date)}</td>
                    <td>{TRANSACTION_TYPE_LABELS[t.transaction_type]}</td>
                    <td>{jobs.find(j => j.id === t.job_id)?.title || "—"}</td>
                    <td>{money(t.amount)}</td>
                    <td><span className={`pill status-${t.status}`}>{t.status}</span></td>
                  </tr>
                ))}
                {confirmedInRange.length === 0 && <tr><td colSpan={5} className="muted">No confirmed transactions in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
