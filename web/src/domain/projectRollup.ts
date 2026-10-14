// One summary row per project with costing, shared by Company Financials
// and the Dashboard's money panel so both show the same numbers.
import { computeProjectFinancials, type HealthStatus } from "./costing";
import { isCustomerPayment } from "./transactions";
import type { ChangeOrder, CostLineItem, Job, ProfitRelease, ProjectFinancials, Transaction } from "./types";

export interface ProjectRollup {
  job: Job;
  pf: ProjectFinancials;
  revenue: number;
  paymentsReceived: number;
  balanceDue: number;
  customerCredit: number;
  // False until the project has a cost item: its profit and margin are
  // unknown (not 100%) and it frees no cash.
  hasCostData: boolean;
  forecastProfitValue: number;
  forecastMarginValue: number;
  requiredReserve: number;
  safeWithdraw: number;
  healthStatus: HealthStatus;
  minimumMarginPct: number;
}

export function rollupProject(job: Job, pf: ProjectFinancials, items: CostLineItem[], approvedChangeOrdersTotal: number, transactions: Transaction[], releasedTotal: number, defaultMinMargin: number, defaultContingency: number): ProjectRollup {
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
    balanceDue: summary.balanceDue,
    customerCredit: summary.customerCredit,
    hasCostData: summary.hasCostData,
    forecastProfitValue: summary.forecastProfit,
    forecastMarginValue: summary.forecastMarginPct,
    requiredReserve: summary.requiredReserve,
    safeWithdraw: summary.safeToWithdraw,
    healthStatus: summary.health.status,
    minimumMarginPct
  };
}

export function rollupCompanyProjects(input: {
  jobs: Job[];
  financials: ProjectFinancials[];
  items: CostLineItem[];
  changeOrders: ChangeOrder[];
  transactions: Transaction[];
  releases: ProfitRelease[];
  defaultMinMargin: number;
  defaultContingency: number;
}): ProjectRollup[] {
  return input.financials
    .map(pf => {
      const job = input.jobs.find(j => j.id === pf.job_id);
      if (!job) return null;
      const approvedChangeOrdersTotal = input.changeOrders
        .filter(co => co.job_id === job.id && co.status === "approved")
        .reduce((t, co) => t + Number(co.amount || 0), 0);
      const releasedTotal = input.releases.filter(r => r.job_id === job.id).reduce((t, r) => t + Number(r.amount || 0), 0);
      return rollupProject(
        job, pf,
        input.items.filter(i => i.job_id === job.id),
        approvedChangeOrdersTotal,
        input.transactions.filter(t => t.job_id === job.id),
        releasedTotal,
        input.defaultMinMargin,
        input.defaultContingency
      );
    })
    .filter((r): r is ProjectRollup => r !== null);
}
