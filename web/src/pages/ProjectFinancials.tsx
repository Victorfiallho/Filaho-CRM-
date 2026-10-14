import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, FileDiff, HelpCircle, Layers, PiggyBank, Plus, Receipt, RotateCcw, Trash2, Undo2, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import { deleteChangeOrder, insertChangeOrder, setChangeOrderStatus } from "../data/changeOrders";
import { deleteCostLineItem, insertCostLineItem, updateCostLineItem } from "../data/costLineItems";
import {
  useChangeOrders,
  useCostLineItems,
  useCustomers,
  useFinanceSettings,
  useJobs,
  useIsOwner,
  useProfitReleases,
  useProjectFinancials,
  useRefunds,
  useTransactionsByJob,
  useUsers,
  useVendors
} from "../data/hooks";
import { insertProfitRelease } from "../data/profitReleases";
import { createProjectFinancials, updateProjectFinancials } from "../data/projectFinancials";
import { insertRefund, updateRefund } from "../data/refunds";
import { confirmTransaction, deleteDraftTransaction, insertTransaction, reverseTransaction } from "../data/transactions";
import { categoryBudgetUsage, computeProjectFinancials, type CostingMessage, type HealthStatus, type ProjectFinancialsSummary } from "../domain/costing";
import { isCustomerPayment, OWNER_AMBIGUOUS_TYPES } from "../domain/transactions";
import { findOrCreateVendor } from "../data/vendors";
import { formatDay, money, uid } from "../domain/format";
import type { Tone } from "../domain/visual";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useT } from "../i18n/I18nContext";
import { en, type MessageKey } from "../i18n/messages";
import { useConfirm } from "../state/ConfirmContext";
import {
  COST_CATEGORIES,
  COST_LINE_ITEM_STATUSES,
  REFUND_STATUSES,
  TRANSACTION_TYPES,
  type ChangeOrder,
  type ChangeOrderStatus,
  type CostCategory,
  type CostLineItem,
  type CostLineItemStatus,
  type ProfitRelease,
  type Refund,
  type RefundStatus,
  type Transaction,
  type TransactionType,
  type Vendor
} from "../domain/types";

const HEALTH_ICON: Record<HealthStatus, typeof CheckCircle2> = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  red: XCircle,
  gray: HelpCircle
};

const CO_TONE: Record<ChangeOrderStatus, Tone> = { draft: "amber", approved: "green", rejected: "rose" };
const TXN_TONE: Record<string, Tone> = { draft: "amber", confirmed: "green", reversed: "slate", void: "slate" };

// Four tabs instead of seven stacked sections: what a person comes here to
// do (check the state, edit terms, log costs, log money in) each gets one.
const TABS = ["overview", "contract", "costs", "payments"] as const;
type TabId = typeof TABS[number];

type ContractField = "original_contract_value" | "discounts" | "customer_fees" | "minimum_margin_pct" | "deposit_pct" | "payments_received_manual";

// Label lookups shared by the cards below. Data values without a known key
// (a category or status added later) show as typed.
function useLabels() {
  const { t, locale } = useT();
  const has = (key: string) => key in en;
  const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  return {
    category: (c: string) => (has(`cat.${c}`) ? t(`cat.${c}` as MessageKey) : c),
    itemStatus: (s: string) => (has(`pf.itemStatus.${s}`) ? t(`pf.itemStatus.${s}` as MessageKey) : s),
    refundStatus: (s: string) => (has(`pf.refundStatus.${s}`) ? t(`pf.refundStatus.${s}` as MessageKey) : s),
    coStatus: (s: string) => (has(`pf.coStatus.${s}`) ? t(`pf.coStatus.${s}` as MessageKey) : s),
    txnType: (s: string) => capitalize(has(`txn.${s}`) ? t(`txn.${s}` as MessageKey) : s),
    txnStatus: (s: string) => capitalize(has(`txnStatus.${s}`) ? t(`txnStatus.${s}` as MessageKey) : s),
    jobStatus: (s: string) => capitalize(has(`status.${s}`) ? t(`status.${s}` as MessageKey) : s)
  };
}

export default function ProjectFinancials() {
  const { jobId } = useParams<{ jobId: string }>();
  const { activeCompanyId } = useCompany();
  const { session } = useAuth();
  const { isOwner } = useIsOwner();
  const { t, locale } = useT();
  const labels = useLabels();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const job = jobs.find(j => j.id === jobId);
  const { data: customers = [] } = useCustomers(activeCompanyId);

  const { data: settings, isLoading: settingsLoading } = useFinanceSettings(activeCompanyId);
  const { data: pf, isLoading: pfLoading } = useProjectFinancials(jobId || null);
  const { data: items = [], isLoading: itemsLoading } = useCostLineItems(jobId || null);
  const { data: changeOrders = [], isLoading: coLoading } = useChangeOrders(jobId || null);
  const { data: vendors = [] } = useVendors(activeCompanyId);
  const { data: users = [] } = useUsers();
  const { data: transactions = [], isLoading: txnLoading } = useTransactionsByJob(jobId || null);
  const { data: refunds = [], isLoading: refundsLoading } = useRefunds(jobId || null);
  const { data: profitReleases = [], isLoading: releasesLoading } = useProfitReleases(jobId || null);

  const [savingSetup, setSavingSetup] = useState(false);
  const [setupContract, setSetupContract] = useState<string>("");
  // Header shortcuts switch tab, then scroll to + focus that tab's form.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [paymentFormKey, setPaymentFormKey] = useState(0);

  const tabParam = searchParams.get("tab");
  const activeTab: TabId = TABS.some(id => id === tabParam) ? (tabParam as TabId) : "overview";
  const setTab = (tab: TabId) => setSearchParams(prev => { const next = new URLSearchParams(prev); next.set("tab", tab); return next; }, { replace: true });

  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(focusTarget);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLElement>("input, .cs-trigger")?.focus({ preventScroll: true });
    setFocusTarget(null);
  }, [focusTarget, activeTab]);

  const loading = jobsLoading || settingsLoading || pfLoading || itemsLoading || coLoading || txnLoading || refundsLoading || releasesLoading;
  if (loading) return <PageSkeleton kpis={4} rows={[5]} />;

  if (!job) {
    return (
      <EmptyState icon={HelpCircle} action={<Link className="action-pill" to="/jobs"><ArrowLeft />{t("pf.backToJobs")}</Link>}>
        {t("pf.jobNotFound")}
      </EmptyState>
    );
  }

  async function handleSetup() {
    if (!activeCompanyId || !job) return;
    setSavingSetup(true);
    try {
      await createProjectFinancials({
        company_id: activeCompanyId,
        job_id: job.id,
        original_contract_value: Number(setupContract || job.estimated_value || 0)
      });
      queryClient.invalidateQueries({ queryKey: ["project-financials", job.id] });
      toast(t("pf.setupDone"));
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.setup")));
    } finally {
      setSavingSetup(false);
    }
  }

  const breadcrumb = (
    <nav className="breadcrumb" aria-label={t("pf.breadcrumb")}>
      <Link to="/jobs">{t("nav.jobs")}</Link><ChevronRight aria-hidden="true" />
      <span>{job.title}</span><ChevronRight aria-hidden="true" />
      <span aria-current="page">{t("pf.financials")}</span>
    </nav>
  );

  if (!pf) {
    return (
      <div className="project-financials">
        {breadcrumb}
        <section className="card pf-setup">
          <div className="card-h"><div><h3>{t("pf.setupTitle")}</h3><span className="sub">{job.title}</span></div></div>
          <div className="card-b">
            <p className="sub">{t("pf.setupIntro")}</p>
            <div className="field">
              <label htmlFor="pf-setup-contract">{t("pf.originalContract")}</label>
              <div className="input-affix">
                <span className="affix">$</span>
                <input id="pf-setup-contract" type="number" placeholder={String(job.estimated_value || 0)} value={setupContract} onChange={e => setSetupContract(e.target.value)} />
              </div>
            </div>
            <button className="btn" disabled={savingSetup} onClick={handleSetup}>
              {savingSetup ? t("pf.settingUp") : t("pf.setupButton")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  const minimumMarginPct = pf.minimum_margin_pct ?? settings?.default_minimum_margin_pct ?? 35;
  const contingencyPct = pf.contingency_pct ?? settings?.default_contingency_pct ?? 10;
  const ledgerPayments = transactions.filter(tx => tx.status === "confirmed" && isCustomerPayment(tx.transaction_type));
  const approvedChangeOrdersTotal = changeOrders.filter(co => co.status === "approved").reduce((sum, co) => sum + Number(co.amount || 0), 0);
  const summary = computeProjectFinancials({
    originalContractValue: Number(pf.original_contract_value || 0),
    discounts: Number(pf.discounts || 0),
    customerFees: Number(pf.customer_fees || 0),
    approvedChangeOrdersTotal,
    minimumMarginPct,
    contingencyPct,
    minimumProfitUsd: pf.minimum_profit_usd,
    paymentsReceivedManual: Number(pf.payments_received_manual || 0),
    ledgerPaymentsReceived: ledgerPayments.length ? ledgerPayments.reduce((sum, x) => sum + Number(x.amount || 0), 0) : null,
    releasedTotal: profitReleases.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    items
  });
  const { health } = summary;
  const HealthIcon = HEALTH_ICON[health.status];
  const client = customers.find(c => c.id === job.customer_id);
  const jobStatus = job.status || "planned";

  // The domain's English sentences, in the user's language. A category
  // name inside a sentence reads lowercase in both languages.
  const say = (m: CostingMessage) => {
    const vars = m.vars && "category" in m.vars ? { ...m.vars, category: labels.category(String(m.vars.category)).toLocaleLowerCase(locale) } : m.vars;
    return t(m.key as MessageKey, vars);
  };
  // "$1,000 − $10 discount + $2 fees": the arithmetic behind the contract
  // value, same rules as the domain's contractNote().
  const noteParts = [money(Number(pf.original_contract_value || 0))];
  if (Number(pf.discounts)) noteParts.push(t("pf.note.discount", { amount: money(Number(pf.discounts)) }));
  if (Number(pf.customer_fees)) noteParts.push(t("pf.note.fees", { amount: money(Number(pf.customer_fees)) }));
  if (approvedChangeOrdersTotal) noteParts.push(t("pf.note.changeOrders", { sign: approvedChangeOrdersTotal < 0 ? "−" : "+", amount: money(Math.abs(approvedChangeOrdersTotal)) }));
  const contractNote = noteParts.length === 1 ? t("pf.note.none") : noteParts.join(" ");
  const noCostNotice = summary.safeToWithdrawNotice ? t("pf.noCostNotice") : null;

  async function handleSaveContract(field: ContractField, value: number) {
    if (!activeCompanyId || !pf) return;
    try {
      await updateProjectFinancials(pf.id, activeCompanyId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ["project-financials", pf.job_id] });
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.save")));
    }
  }

  function goTo(tab: TabId, target: string) {
    setTab(tab);
    setFocusTarget(target);
  }

  const receivedHint = summary.customerCredit > 0
    ? <span className="tag-credit">{t("pf.customerCredit", { amount: money(summary.customerCredit) })}</span>
    : summary.balanceDue > 0
      ? t("pf.stillDue", { amount: money(summary.balanceDue) })
      : t("pf.paidInFull");

  const moreMetrics: { label: string; value: number; hint: string }[] = [
    { label: t("pf.m.balanceDue"), value: summary.balanceDue, hint: t("pf.m.balanceDueHint") },
    { label: t("pf.m.estimatedCost"), value: summary.estimatedCost, hint: t("pf.m.estimatedCostHint", { amount: money(summary.contingencyUsd) }) },
    { label: t("pf.m.actualCost"), value: summary.actualNetCost, hint: t("pf.m.actualCostHint") },
    { label: t("pf.m.committed"), value: summary.committedUnpaid, hint: t("pf.m.committedHint") },
    { label: t("pf.m.forecastCost"), value: summary.forecastCost, hint: t("pf.m.forecastCostHint") },
    { label: t("pf.m.expectedProfit"), value: summary.expectedProfit, hint: t("pf.m.expectedProfitHint", { margin: summary.expectedMarginPct.toFixed(1) }) },
    { label: t("pf.m.minimumProfit"), value: summary.minimumProfit, hint: t("pf.m.minimumProfitHint", { min: minimumMarginPct }) },
    { label: t("pf.m.remainingBudget"), value: summary.remainingBudget, hint: t("pf.m.remainingBudgetHint") },
    { label: t("pf.m.reserve"), value: summary.requiredReserve, hint: t("pf.m.reserveHint") },
    { label: t("pf.m.released"), value: summary.releasedTotal, hint: t("pf.m.releasedHint") }
  ];

  return (
    <div className="project-financials">
      {breadcrumb}

      <header className="pf-header">
        <div style={{ minWidth: 0 }}>
          <h2>{job.title}</h2>
          <div className="pf-meta">
            <span className={`pill status-${jobStatus.replace(/\s+/g, "-")}`}>{labels.jobStatus(jobStatus)}</span>
            {client && <span>{client.name}</span>}
            {job.scheduled_date && <span>{t("pf.scheduled", { date: formatDay(job.scheduled_date, undefined, locale) })}</span>}
            {pf.start_date && <span>{t("pf.start", { date: formatDay(pf.start_date, undefined, locale) })}</span>}
            {pf.target_completion_date && <span>{t("pf.target", { date: formatDay(pf.target_completion_date, undefined, locale) })}</span>}
          </div>
        </div>
        <div className="inline-actions">
          <button className="btn ghost slim" onClick={() => goTo("costs", "cost-item-form")}><Plus />{t("pf.addCost")}</button>
          <button className="btn slim" onClick={() => { setPaymentFormKey(k => k + 1); goTo("payments", "payment-form"); }}><Receipt />{t("pf.logPayment")}</button>
        </div>
      </header>

      <section className={`health-banner health-${health.status}`} role="status">
        <HealthIcon aria-hidden="true" />
        <div>
          <b>{t(`health.${health.status}` as MessageKey)}</b>
          <div className="health-alert">{health.reasonParts.map(say).join(" ")}</div>
          {health.alertMessages.map((a, i) => <div key={i} className="health-alert">{say(a)}</div>)}
        </div>
      </section>

      <div style={{ marginTop: 16 }}>
        <KpiStrip items={[
          { label: t("pf.kpi.contract"), value: money(summary.revenue), hint: contractNote, tone: "blue" },
          { label: t("pf.kpi.received"), value: money(summary.paymentsReceived), hint: receivedHint, tone: "green" },
          {
            label: t("pf.kpi.forecastProfit"),
            value: summary.hasCostData ? money(summary.forecastProfit) : "—",
            hint: summary.hasCostData ? t("pf.kpi.marginHint", { margin: summary.forecastMarginPct.toFixed(1), min: minimumMarginPct }) : t("pf.kpi.needsCosts"),
            tone: "purple"
          },
          {
            label: t("pf.kpi.safe"),
            value: money(summary.safeToWithdraw),
            hint: noCostNotice ?? (summary.safeToWithdraw === 0 ? t("pf.kpi.safeReserved") : t("pf.kpi.safeHint")),
            tone: "teal"
          }
        ]} />
      </div>

      <details className="card more-metrics" style={{ marginTop: 16 }}>
        <summary>{t("pf.moreMetrics", { count: moreMetrics.length })}</summary>
        <div className="mini-stats five">
          {moreMetrics.map(m => (
            <div key={m.label}><span className="label">{m.label}</span><b>{money(m.value)}</b><span className="sub">{m.hint}</span></div>
          ))}
        </div>
      </details>

      <div className="pf-tabs" role="tablist" aria-label={t("pf.sections")}>
        {TABS.map(id => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            className={activeTab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {t(`pf.tab.${id}` as MessageKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "overview" && (
          <>
            <OverviewCard summary={summary} changeOrders={changeOrders} items={items} />
            <ProfitReleaseCard
              jobId={job.id}
              companyId={activeCompanyId!}
              releases={profitReleases}
              health={health}
              safeToWithdrawAmount={summary.safeToWithdraw}
              noCostNotice={noCostNotice}
              stageRequired={pf.profit_release_stage}
              currentStage={job.status}
              isOwnerUser={isOwner}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["profit-releases", job.id] })}
            />
          </>
        )}

        {activeTab === "contract" && (
          <section className="card pf-card">
            <div className="card-h"><div><h3>{t("pf.contractTitle")}</h3><span className="sub">{t("pf.savesOnBlur")}</span></div></div>
            <div className="card-b">
              <div className="form-row">
                <NumberField label={t("pf.originalContract")} prefix="$" value={pf.original_contract_value} onSave={v => handleSaveContract("original_contract_value", v)} />
                <NumberField label={t("pf.discounts")} prefix="$" value={pf.discounts} onSave={v => handleSaveContract("discounts", v)} />
                <NumberField label={t("pf.customerFees")} prefix="$" value={pf.customer_fees} onSave={v => handleSaveContract("customer_fees", v)} />
                {isOwner ? (
                  <NumberField label={t("pf.minMarginDefault", { pct: settings?.default_minimum_margin_pct ?? 35 })} suffix="%" value={pf.minimum_margin_pct ?? ""} onSave={v => handleSaveContract("minimum_margin_pct", v)} />
                ) : (
                  <div className="field">
                    <label htmlFor="pf-min-margin">{t("pf.minMargin")}</label>
                    <div className="input-affix">
                      <input id="pf-min-margin" value={pf.minimum_margin_pct ?? t("pf.companyDefault", { pct: settings?.default_minimum_margin_pct ?? 35 })} disabled />
                      <span className="affix">%</span>
                    </div>
                  </div>
                )}
                <NumberField label={t("pf.deposit")} suffix="%" value={pf.deposit_pct} onSave={v => handleSaveContract("deposit_pct", v)} />
              </div>
              <p className="sub" style={{ marginTop: 10 }}>{t("pf.contractValueLine", { amount: money(summary.revenue), note: contractNote })}</p>
            </div>
          </section>
        )}

        {activeTab === "costs" && (
          <>
            <section className="card pf-card">
              <div className="mini-stats five pf-cost-stats">
                <div><span className="label">{t("pf.cost.estimated")}</span><b>{money(summary.estimatedCost - summary.contingencyUsd)}</b></div>
                <div><span className="label">{t("pf.cost.contingency", { pct: contingencyPct })}</span><b>{money(summary.contingencyUsd)}</b></div>
                <div><span className="label">{t("pf.cost.total")}</span><b>{money(summary.estimatedCost)}</b></div>
                <div><span className="label">{t("pf.cost.actual")}</span><b>{money(summary.actualNetCost)}</b></div>
                <div><span className="label">{t("pf.cost.committed")}</span><b>{money(summary.committedUnpaid)}</b></div>
              </div>
            </section>
            <CostLineItemsCard
              jobId={job.id}
              companyId={activeCompanyId!}
              items={items}
              vendors={vendors}
              users={users}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["cost-line-items", job.id] })}
            />
            <RefundsCard
              jobId={job.id}
              companyId={activeCompanyId!}
              refunds={refunds}
              costLineItems={items}
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["refunds", job.id] });
                queryClient.invalidateQueries({ queryKey: ["cost-line-items", job.id] });
              }}
            />
          </>
        )}

        {activeTab === "payments" && (
          <>
            <section className="card pf-card">
              <div className="card-h"><h3>{t("pf.paymentsTitle")}</h3></div>
              <div className="card-b">
                <div className="form-row">
                  <NumberField
                    label={t("pf.paymentsManual")}
                    prefix="$"
                    value={pf.payments_received_manual}
                    onSave={v => handleSaveContract("payments_received_manual", v)}
                  />
                </div>
                <p className="sub" style={{ marginTop: 8 }}>
                  {summary.paymentsFromLedger ? t("pf.paymentsFromLedger", { amount: money(summary.paymentsReceived) }) : t("pf.paymentsManualHint")}
                </p>
              </div>
            </section>
            <TransactionLedgerCard
              key={paymentFormKey}
              jobId={job.id}
              companyId={activeCompanyId!}
              clientId={job.customer_id}
              transactions={transactions}
              vendors={vendors}
              approverId={session?.user.id || null}
              canReverse={isOwner}
              defaultType={paymentFormKey > 0 ? (summary.paymentsReceived > 0 ? "progress_payment" : "customer_deposit") : undefined}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["transactions-job", job.id] })}
            />
            <ChangeOrdersCard
              jobId={job.id}
              companyId={activeCompanyId!}
              changeOrders={changeOrders}
              approverId={session?.user.id || null}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["change-orders", job.id] })}
            />
          </>
        )}
      </div>
    </div>
  );
}

// A table card: title, the table (or an empty line), then the add form.
function TableCard({ title, sub, empty, emptyIcon, isEmpty, table, children }: {
  title: string; sub?: string; empty: string; emptyIcon: typeof Plus; isEmpty: boolean; table: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="card table-card pf-card">
      <div className="card-h"><div><h3>{title}</h3>{sub && <span className="sub">{sub}</span>}</div></div>
      {isEmpty ? <div className="card-b"><EmptyState icon={emptyIcon}>{empty}</EmptyState></div> : <div className="table-wrap">{table}</div>}
      {children && <div className="card-b pf-add">{children}</div>}
    </section>
  );
}

// Plain-language summary of where the project stands, plus cost by category
// against its budget once costs exist.
function OverviewCard({ summary, changeOrders, items }: { summary: ProjectFinancialsSummary; changeOrders: ChangeOrder[]; items: CostLineItem[] }) {
  const { t, tn } = useT();
  const labels = useLabels();
  const pendingChangeOrders = changeOrders.filter(co => co.status === "draft").length;
  const lines = [
    summary.customerCredit > 0
      ? t("pf.sum.credit", { amount: money(summary.customerCredit) })
      : summary.balanceDue > 0
        ? t("pf.sum.partial", { received: money(summary.paymentsReceived), total: money(summary.revenue), due: money(summary.balanceDue) })
        : t("pf.sum.paid", { amount: money(summary.paymentsReceived) }),
    summary.hasCostData
      ? t("pf.sum.forecast", { forecast: money(summary.forecastCost), estimate: money(summary.estimatedCost), left: money(summary.remainingBudget) })
      : t("pf.sum.noCosts"),
    pendingChangeOrders > 0 ? tn("pf.sum.pendingCo", pendingChangeOrders) : null
  ].filter(Boolean) as string[];
  const categories = categoryBudgetUsage(items);

  return (
    <section className="card table-card pf-card">
      <div className="card-h"><h3>{t("pf.summaryTitle")}</h3></div>
      <div className="card-b"><ul className="pf-summary">{lines.map(line => <li key={line}>{line}</li>)}</ul></div>
      {categories.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>{t("pf.col.category")}</th><th className="num">{t("pf.col.estimated")}</th><th className="num">{t("pf.col.actual")}</th><th className="num">{t("pf.col.difference")}</th></tr></thead>
            <tbody>
              {categories.map(c => (
                <tr key={c.category}>
                  <td>{labels.category(c.category)}</td>
                  <td className="num">{money(c.estimated)}</td>
                  <td className="num">{money(c.actual)}</td>
                  <td className={`num ${c.overBy > 0 ? "text-danger" : ""}`}>{c.overBy > 0 ? t("pf.over", { amount: money(c.overBy) }) : t("pf.under", { amount: money(-c.overBy) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NumberField({ label, value, onSave, prefix, suffix }: { label: string; value: number | string; onSave: (v: number) => void; prefix?: string; suffix?: string }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  return (
    <div className="field">
      <label>{label}</label>
      <div className={prefix || suffix ? "input-affix" : undefined}>
        {prefix && <span className="affix">{prefix}</span>}
        <input
          type="number"
          aria-label={label}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { const n = Number(draft); if (Number.isFinite(n) && n !== Number(value || 0)) onSave(n); }}
        />
        {suffix && <span className="affix">{suffix}</span>}
      </div>
    </div>
  );
}

function ChangeOrdersCard({ jobId, companyId, changeOrders, approverId, onChanged }: {
  jobId: string; companyId: string; changeOrders: ChangeOrder[]; approverId: string | null; onChanged: () => void;
}) {
  const { t } = useT();
  const labels = useLabels();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!description.trim() || !amount) return;
    setSaving(true);
    try {
      await insertChangeOrder({ company_id: companyId, job_id: jobId, description: description.trim(), amount: Number(amount) });
      setDescription(""); setAmount("");
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.addCo")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableCard
      title={t("pf.coTitle")}
      empty={t("pf.coEmpty")}
      emptyIcon={FileDiff}
      isEmpty={changeOrders.length === 0}
      table={
        <table className="data-table">
          <thead><tr><th>{t("pf.col.description")}</th><th className="num">{t("pf.col.amount")}</th><th>{t("pf.col.status")}</th><th><span className="sr-only">{t("pf.col.actions")}</span></th></tr></thead>
          <tbody>
            {changeOrders.map(co => (
              <tr key={co.id}>
                <td>{co.description}</td>
                <td className="num">{money(co.amount)}</td>
                <td><span className={`badge-tone tone-${CO_TONE[co.status] ?? "slate"}`}>{labels.coStatus(co.status)}</span></td>
                <td>
                  <div className="row-actions">
                    {co.status === "draft" && (
                      <>
                        <button className="action-pill" onClick={async () => { await setChangeOrderStatus(co.id, companyId, "approved", approverId); onChanged(); }}><CheckCircle2 />{t("pf.approve")}</button>
                        <button className="action-pill" onClick={async () => { await setChangeOrderStatus(co.id, companyId, "rejected", approverId); onChanged(); }}><XCircle />{t("pf.reject")}</button>
                      </>
                    )}
                    <button className="round-btn small danger" aria-label={t("pf.delete")} title={t("pf.delete")} onClick={async () => { await deleteChangeOrder(co.id, companyId); onChanged(); }}><Trash2 /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <h4 className="form-section-title">{t("pf.coAdd")}</h4>
      <div className="form-row">
        <div className="field"><label htmlFor="co-desc">{t("pf.col.description")}</label><input id="co-desc" value={description} onChange={e => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="co-amount">{t("pf.col.amount")}</label><div className="input-affix"><span className="affix">$</span><input id="co-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div></div>
      </div>
      <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />{t("pf.coAdd")}</button>
    </TableCard>
  );
}

const EMPTY_ITEM_FORM = { category: "materials" as CostCategory, description: "", vendorName: "", estimated_cost: "", committed_amount: "", actual_paid: "", tax: "", freight: "", discount: "", returned_amount: "", internal_cost: "", status: "planned" as CostLineItemStatus, responsible_user_id: "", notes: "" };

function CostLineItemsCard({ jobId, companyId, items, vendors, users, onChanged }: {
  jobId: string;
  companyId: string;
  items: CostLineItem[];
  vendors: Vendor[];
  users: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const { t } = useT();
  const labels = useLabels();
  const [form, setForm] = useState(EMPTY_ITEM_FORM);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY_ITEM_FORM>(key: K, value: typeof EMPTY_ITEM_FORM[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function addItem() {
    if (!form.description.trim()) { toast(t("pf.err.descriptionRequired")); return; }
    setSaving(true);
    try {
      let vendorId: string | null = null;
      if (form.vendorName.trim()) {
        const vendor = await findOrCreateVendor(companyId, form.vendorName.trim());
        vendorId = vendor.id;
      }
      await insertCostLineItem({
        id: uid("cli"),
        company_id: companyId,
        job_id: jobId,
        category: form.category,
        description: form.description.trim(),
        vendor_id: vendorId,
        estimated_cost: Number(form.estimated_cost || 0),
        quoted_to_customer: 0,
        committed_amount: Number(form.committed_amount || 0),
        actual_paid: Number(form.actual_paid || 0),
        internal_cost: Number(form.internal_cost || 0),
        tax: Number(form.tax || 0),
        freight: Number(form.freight || 0),
        discount: Number(form.discount || 0),
        returned_amount: Number(form.returned_amount || 0),
        expected_date: null,
        purchase_date: null,
        payment_method: "",
        status: form.status,
        responsible_user_id: form.responsible_user_id || null,
        receipt_id: null,
        notes: form.notes
      });
      setForm(EMPTY_ITEM_FORM);
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.addItem")));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(itemId: string, status: CostLineItemStatus) {
    await updateCostLineItem(itemId, companyId, { status });
    onChanged();
  }

  async function remove(itemId: string) {
    await deleteCostLineItem(itemId, companyId);
    onChanged();
  }

  const amountField = (key: "estimated_cost" | "committed_amount" | "actual_paid" | "internal_cost" | "tax" | "freight" | "discount" | "returned_amount", label: string) => (
    <div className="field">
      <label htmlFor={`cli-${key}`}>{label}</label>
      <div className="input-affix"><span className="affix">$</span><input id={`cli-${key}`} type="number" value={form[key]} onChange={e => set(key, e.target.value)} /></div>
    </div>
  );

  return (
    <TableCard
      title={t("pf.itemsTitle")}
      empty={t("pf.itemsEmpty")}
      emptyIcon={Layers}
      isEmpty={items.length === 0}
      table={
        <table className="data-table">
          <thead>
            <tr><th>{t("pf.col.category")}</th><th>{t("pf.col.description")}</th><th>{t("pf.col.vendor")}</th><th className="num">{t("pf.col.estimated")}</th><th className="num">{t("pf.col.actual")}</th><th className="num">{t("pf.col.net")}</th><th>{t("pf.col.status")}</th><th><span className="sr-only">{t("pf.col.actions")}</span></th></tr>
          </thead>
          <tbody>
            {items.map(item => {
              const vendor = vendors.find(v => v.id === item.vendor_id);
              return (
                <tr key={item.id}>
                  <td>{labels.category(item.category)}</td>
                  <td><b className="cell-strong">{item.description}</b>{item.internal_cost > 0 && <div className="sub">{t("pf.internalCost", { amount: money(item.internal_cost) })}</div>}</td>
                  <td>{vendor?.canonical_name || <span className="cell-missing">—</span>}</td>
                  <td className="num">{money(item.estimated_cost)}</td>
                  <td className="num">{money(item.actual_paid)}</td>
                  <td className="num">{money(item.net_cost)}</td>
                  <td className="pf-status-cell">
                    <Select
                      value={item.status}
                      onChange={v => setStatus(item.id, v as CostLineItemStatus)}
                      aria-label={t("pf.col.status")}
                      options={COST_LINE_ITEM_STATUSES.map(s => ({ value: s, label: labels.itemStatus(s) }))}
                    />
                  </td>
                  <td><button className="round-btn small danger" aria-label={t("pf.delete")} title={t("pf.delete")} onClick={() => remove(item.id)}><Trash2 /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      }
    >
      <h4 className="form-section-title">{t("pf.addItem")}</h4>
      <div className="form-row" id="cost-item-form">
        <div className="field">
          <label>{t("pf.col.category")}</label>
          <Select value={form.category} onChange={v => set("category", v as CostCategory)} aria-label={t("pf.col.category")} options={COST_CATEGORIES.map(c => ({ value: c, label: labels.category(c) }))} />
        </div>
        <div className="field"><label htmlFor="cli-desc">{t("pf.col.description")}</label><input id="cli-desc" value={form.description} onChange={e => set("description", e.target.value)} /></div>
        <div className="field"><label htmlFor="cli-vendor">{t("pf.col.vendor")}</label><input id="cli-vendor" value={form.vendorName} onChange={e => set("vendorName", e.target.value)} placeholder={t("pf.vendorPlaceholder")} /></div>
        {amountField("estimated_cost", t("pf.f.estimated"))}
        {amountField("committed_amount", t("pf.f.committed"))}
        {amountField("actual_paid", t("pf.f.actualPaid"))}
      </div>
      <details className="help-details pf-more-fields">
        <summary>{t("pf.moreFields")}</summary>
        <div className="form-row">
          {amountField("internal_cost", t("pf.f.internal"))}
          {amountField("tax", t("pf.f.tax"))}
          {amountField("freight", t("pf.f.freight"))}
          {amountField("discount", t("pf.f.discount"))}
          {amountField("returned_amount", t("pf.f.returned"))}
          <div className="field">
            <label>{t("pf.f.responsible")}</label>
            <Select
              value={form.responsible_user_id}
              onChange={v => set("responsible_user_id", v)}
              aria-label={t("pf.f.responsible")}
              options={[{ value: "", label: t("rec.unassigned") }, ...users.map(u => ({ value: u.id, label: u.name }))]}
            />
          </div>
        </div>
      </details>
      <button className="btn slim" style={{ marginTop: 8 }} disabled={saving} onClick={addItem}><Plus />{t("pf.addItem")}</button>
    </TableCard>
  );
}

const EMPTY_TXN_FORM = { transaction_type: "material_purchase" as TransactionType, payee_name: "", description: "", amount: "", sales_tax: "", transaction_date: new Date().toISOString().slice(0, 10), payment_method: "", account: "" };

function TransactionLedgerCard({ jobId, companyId, clientId, transactions, vendors, approverId, canReverse, defaultType, onChanged }: {
  jobId: string;
  companyId: string;
  clientId: string | null;
  transactions: Transaction[];
  vendors: Vendor[];
  approverId: string | null;
  canReverse: boolean;
  defaultType?: TransactionType;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const labels = useLabels();
  // `confirm` is this card's own transaction-confirm handler below.
  const { promptText } = useConfirm();
  const [form, setForm] = useState(() => (defaultType ? { ...EMPTY_TXN_FORM, transaction_type: defaultType } : EMPTY_TXN_FORM));
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY_TXN_FORM>(key: K, value: typeof EMPTY_TXN_FORM[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function add() {
    if (!form.amount) { toast(t("pf.err.amountRequired")); return; }
    setSaving(true);
    try {
      await insertTransaction({
        company_id: companyId,
        client_id: clientId,
        job_id: jobId,
        transaction_type: form.transaction_type,
        category: "",
        vendor_id: null,
        payee_name: form.payee_name.trim(),
        description: form.description.trim(),
        transaction_date: form.transaction_date,
        due_date: null,
        amount: Number(form.amount || 0),
        sales_tax: Number(form.sales_tax || 0),
        payment_method: form.payment_method,
        account: form.account,
        receipt_id: null
      });
      setForm(EMPTY_TXN_FORM);
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.addTxn")));
    } finally {
      setSaving(false);
    }
  }

  async function confirm(id: string) {
    try {
      await confirmTransaction(id, companyId, approverId);
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.confirmTxn")));
    }
  }

  async function reverse(txn: Transaction) {
    const reason = await promptText({ title: t("confirm.reverseTitle"), label: t("confirm.reverseReason"), confirmLabel: t("confirm.reverse") });
    if (reason === null) return;
    try {
      await reverseTransaction(txn, reason || "no reason given");
      toast(t("pf.reversalCreated"));
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.reverse")));
    }
  }

  async function removeDraft(id: string) {
    await deleteDraftTransaction(id, companyId);
    onChanged();
  }

  const showOwnerHint = OWNER_AMBIGUOUS_TYPES.includes(form.transaction_type) && form.payee_name.trim().length > 0;

  return (
    <TableCard
      title={t("pf.txnTitle")}
      sub={t("pf.txnSub")}
      empty={t("pf.txnEmpty")}
      emptyIcon={Receipt}
      isEmpty={transactions.length === 0}
      table={
        <table className="data-table">
          <thead><tr><th>{t("pf.col.date")}</th><th>{t("pf.col.type")}</th><th>{t("pf.col.payee")}</th><th>{t("pf.col.description")}</th><th className="num">{t("pf.col.amount")}</th><th>{t("pf.col.status")}</th><th><span className="sr-only">{t("pf.col.actions")}</span></th></tr></thead>
          <tbody>
            {transactions.map(tx => {
              const vendor = vendors.find(v => v.id === tx.vendor_id);
              return (
                <tr key={tx.id}>
                  <td>{formatDay(tx.transaction_date, undefined, locale)}</td>
                  <td>{labels.txnType(tx.transaction_type)}</td>
                  <td>{tx.payee_name || vendor?.canonical_name || <span className="cell-missing">—</span>}</td>
                  <td>{tx.description}{tx.reversal_of && <div className="sub">{t("pf.reversalOf", { id: tx.reversal_of })}</div>}</td>
                  <td className="num">{money(tx.amount)}</td>
                  <td><span className={`badge-tone tone-${TXN_TONE[tx.status] ?? "slate"}`}>{labels.txnStatus(tx.status)}</span></td>
                  <td>
                    <div className="row-actions">
                      {tx.status === "draft" && (
                        <>
                          <button className="action-pill" onClick={() => confirm(tx.id)}><CheckCircle2 />{t("pf.confirm")}</button>
                          <button className="round-btn small danger" aria-label={t("pf.deleteDraft")} title={t("pf.deleteDraft")} onClick={() => removeDraft(tx.id)}><Trash2 /></button>
                        </>
                      )}
                      {tx.status === "confirmed" && !tx.reversal_of && canReverse && (
                        <button className="action-pill" onClick={() => reverse(tx)}><Undo2 />{t("confirm.reverse")}</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      }
    >
      <h4 className="form-section-title">{t("pf.addTxn")}</h4>
      <div className="form-row" id="payment-form">
        <div className="field">
          <label>{t("pf.col.type")}</label>
          <Select
            value={form.transaction_type}
            onChange={v => set("transaction_type", v as TransactionType)}
            aria-label={t("pf.col.type")}
            options={TRANSACTION_TYPES.map(type => ({ value: type, label: labels.txnType(type) }))}
          />
        </div>
        <div className="field"><label htmlFor="txn-payee">{t("pf.f.payee")}</label><input id="txn-payee" value={form.payee_name} onChange={e => set("payee_name", e.target.value)} /></div>
        <div className="field"><label htmlFor="txn-desc">{t("pf.col.description")}</label><input id="txn-desc" value={form.description} onChange={e => set("description", e.target.value)} /></div>
        <div className="field"><label htmlFor="txn-amount">{t("pf.col.amount")}</label><div className="input-affix"><span className="affix">$</span><input id="txn-amount" type="number" value={form.amount} onChange={e => set("amount", e.target.value)} /></div></div>
        <div className="field"><label htmlFor="txn-date">{t("pf.col.date")}</label><input id="txn-date" type="date" value={form.transaction_date} onChange={e => set("transaction_date", e.target.value)} /></div>
      </div>
      <details className="help-details pf-more-fields">
        <summary>{t("pf.moreFields")}</summary>
        <div className="form-row">
          <div className="field"><label htmlFor="txn-tax">{t("pf.f.salesTax")}</label><div className="input-affix"><span className="affix">$</span><input id="txn-tax" type="number" value={form.sales_tax} onChange={e => set("sales_tax", e.target.value)} /></div></div>
          <div className="field"><label htmlFor="txn-method">{t("pf.f.method")}</label><input id="txn-method" value={form.payment_method} onChange={e => set("payment_method", e.target.value)} /></div>
          <div className="field"><label htmlFor="txn-account">{t("pf.f.account")}</label><input id="txn-account" value={form.account} onChange={e => set("account", e.target.value)} /></div>
        </div>
      </details>
      {showOwnerHint && (
        <p className="notice-inline" style={{ marginTop: 8 }}>
          {t("pf.ownerHint.before")}<b>{labels.txnType("owner_labor_payment")}</b>{t("pf.ownerHint.middle")}<b>{labels.txnType("owner_draw")}</b>{t("pf.ownerHint.after")}
        </p>
      )}
      <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />{t("pf.addTxnDraft")}</button>
    </TableCard>
  );
}

function RefundsCard({ jobId, companyId, refunds, costLineItems, onChanged }: {
  jobId: string;
  companyId: string;
  refunds: Refund[];
  costLineItems: CostLineItem[];
  onChanged: () => void;
}) {
  const { t } = useT();
  const labels = useLabels();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [costLineItemId, setCostLineItemId] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!amount) return;
    setSaving(true);
    try {
      await insertRefund({
        company_id: companyId,
        job_id: jobId,
        cost_line_item_id: costLineItemId || null,
        transaction_id: null,
        description: description.trim(),
        amount: Number(amount),
        status: "expected",
        expected_date: null,
        received_date: null,
        notes: ""
      });
      setDescription(""); setAmount(""); setCostLineItemId("");
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.addRefund")));
    } finally {
      setSaving(false);
    }
  }

  // Marking a refund received also applies it to the linked purchase's
  // returned_amount, so net_cost/margin actually reflect the money back —
  // the original purchase row is never removed, only its returned_amount grows.
  async function markReceived(refund: Refund) {
    try {
      await updateRefund(refund.id, companyId, { status: "received", received_date: new Date().toISOString().slice(0, 10) });
      if (refund.cost_line_item_id) {
        const item = costLineItems.find(i => i.id === refund.cost_line_item_id);
        if (item) await updateCostLineItem(item.id, companyId, { returned_amount: Number(item.returned_amount || 0) + Number(refund.amount || 0) });
      }
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.updateRefund")));
    }
  }

  async function setStatus(refund: Refund, status: RefundStatus) {
    if (status === "received") { await markReceived(refund); return; }
    await updateRefund(refund.id, companyId, { status });
    onChanged();
  }

  return (
    <TableCard
      title={t("pf.refundsTitle")}
      empty={t("pf.refundsEmpty")}
      emptyIcon={RotateCcw}
      isEmpty={refunds.length === 0}
      table={
        <table className="data-table">
          <thead><tr><th>{t("pf.col.description")}</th><th>{t("pf.col.linked")}</th><th className="num">{t("pf.col.amount")}</th><th>{t("pf.col.status")}</th></tr></thead>
          <tbody>
            {refunds.map(r => {
              const linked = costLineItems.find(i => i.id === r.cost_line_item_id);
              return (
                <tr key={r.id}>
                  <td>{r.description}</td>
                  <td>{linked?.description || <span className="cell-missing">—</span>}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td className="pf-status-cell">
                    <Select value={r.status} onChange={v => setStatus(r, v as RefundStatus)} aria-label={t("pf.col.status")} options={REFUND_STATUSES.map(s => ({ value: s, label: labels.refundStatus(s) }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      }
    >
      <h4 className="form-section-title">{t("pf.addRefund")}</h4>
      <div className="form-row">
        <div className="field"><label htmlFor="refund-desc">{t("pf.col.description")}</label><input id="refund-desc" value={description} onChange={e => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="refund-amount">{t("pf.col.amount")}</label><div className="input-affix"><span className="affix">$</span><input id="refund-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div></div>
        <div className="field">
          <label>{t("pf.f.linked")}</label>
          <Select
            value={costLineItemId}
            onChange={setCostLineItemId}
            aria-label={t("pf.f.linked")}
            options={[{ value: "", label: t("rec.none") }, ...costLineItems.map(i => ({ value: i.id, label: i.description || labels.category(i.category) }))]}
          />
        </div>
      </div>
      <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />{t("pf.addRefund")}</button>
    </TableCard>
  );
}

function ProfitReleaseCard({ jobId, companyId, releases, health, safeToWithdrawAmount, noCostNotice, stageRequired, currentStage, isOwnerUser, onChanged }: {
  jobId: string;
  companyId: string;
  releases: ProfitRelease[];
  health: { status: HealthStatus };
  safeToWithdrawAmount: number;
  noCostNotice: string | null;
  stageRequired: string;
  currentStage: string;
  isOwnerUser: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const labels = useLabels();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const stageBlocked = Boolean(stageRequired) && stageRequired !== currentStage;
  const canRelease = isOwnerUser && safeToWithdrawAmount > 0 && !stageBlocked && health.status !== "red";

  async function release() {
    const value = Number(amount || 0);
    if (!value || value > safeToWithdrawAmount) { toast(t("pf.err.releaseRange", { amount: money(safeToWithdrawAmount) })); return; }
    setSaving(true);
    try {
      await insertProfitRelease({ company_id: companyId, job_id: jobId, amount: value, notes: notes.trim() });
      setAmount(""); setNotes("");
      onChanged();
    } catch (error) {
      toastError(errorMessage(error, t("pf.err.release")));
    } finally {
      setSaving(false);
    }
  }

  const blockedReason = !isOwnerUser
    ? t("pf.release.ownerOnly")
    : noCostNotice
      ? t("pf.release.noCosts", { notice: noCostNotice })
      : stageBlocked
        ? t("pf.release.stage", { required: labels.jobStatus(stageRequired), current: labels.jobStatus(currentStage || "planned") })
        : health.status === "red"
          ? t("pf.release.red")
          : t("pf.release.nothing");

  return (
    <TableCard
      title={t("pf.releaseTitle")}
      sub={canRelease ? t("pf.release.upTo", { amount: money(safeToWithdrawAmount) }) : undefined}
      empty={t("pf.releaseEmpty")}
      emptyIcon={PiggyBank}
      isEmpty={releases.length === 0}
      table={
        <table className="data-table">
          <thead><tr><th>{t("pf.col.date")}</th><th className="num">{t("pf.col.amount")}</th><th>{t("pf.col.notes")}</th></tr></thead>
          <tbody>
            {releases.map(r => (
              <tr key={r.id}><td>{new Date(r.released_at).toLocaleDateString(locale)}</td><td className="num">{money(r.amount)}</td><td>{r.notes}</td></tr>
            ))}
          </tbody>
        </table>
      }
    >
      {canRelease ? (
        <>
          <h4 className="form-section-title">{t("pf.releaseButton")}</h4>
          <div className="form-row">
            <div className="field"><label htmlFor="release-amount">{t("pf.release.amount", { amount: money(safeToWithdrawAmount) })}</label><div className="input-affix"><span className="affix">$</span><input id="release-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div></div>
            <div className="field"><label htmlFor="release-notes">{t("pf.col.notes")}</label><input id="release-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={release}><Plus />{t("pf.releaseButton")}</button>
        </>
      ) : (
        <p className="notice-inline">{blockedReason}</p>
      )}
    </TableCard>
  );
}
