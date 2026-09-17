import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import { deleteChangeOrder, insertChangeOrder, setChangeOrderStatus } from "../data/changeOrders";
import { deleteCostLineItem, insertCostLineItem, updateCostLineItem } from "../data/costLineItems";
import {
  useChangeOrders,
  useCostLineItems,
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
import {
  categoryBudgetUsage,
  contractRevenue,
  estimatedTotalCost,
  evaluateProjectHealth,
  forecastFinalCost,
  expectedProfit,
  forecastProfit,
  marginPct,
  maxAllowedCost,
  minimumProfitForMargin,
  safeToWithdraw,
  sumActualNetCost,
  sumCashPaid,
  sumCommittedUnpaid,
  sumEstimatedCost,
  sumRemainingEstimate,
  type HealthStatus
} from "../domain/costing";
import { isCustomerPayment, OWNER_AMBIGUOUS_TYPES, TRANSACTION_TYPE_LABELS } from "../domain/transactions";
import { findOrCreateVendor } from "../data/vendors";
import { money, titleize, uid } from "../domain/format";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import {
  COST_CATEGORIES,
  COST_LINE_ITEM_STATUSES,
  REFUND_STATUSES,
  TRANSACTION_TYPES,
  type CostCategory,
  type CostLineItemStatus,
  type RefundStatus,
  type TransactionType
} from "../domain/types";

const HEALTH_LABEL: Record<HealthStatus, string> = {
  green: "On track",
  yellow: "Below target",
  red: "Below minimum",
  gray: "Not enough data yet"
};

const HEALTH_ICON: Record<HealthStatus, typeof CheckCircle2> = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  red: XCircle,
  gray: HelpCircle
};

export default function ProjectFinancials() {
  const { jobId } = useParams<{ jobId: string }>();
  const { activeCompanyId } = useCompany();
  const { session } = useAuth();
  const { isOwner } = useIsOwner();
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const job = jobs.find(j => j.id === jobId);

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

  const loading = jobsLoading || settingsLoading || pfLoading || itemsLoading || coLoading || txnLoading || refundsLoading || releasesLoading;
  if (loading) return <PageSkeleton kpis={6} rows={[5]} />;

  if (!job) {
    return (
      <div className="empty">
        <p>Job not found.</p>
        <Link className="btn ghost slim" to="/jobs"><ArrowLeft />Back to Jobs</Link>
      </div>
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
      toast("Project costing set up.");
    } catch (error) {
      toast(errorMessage(error, "Could not set up project financials."));
    } finally {
      setSavingSetup(false);
    }
  }

  if (!pf) {
    return (
      <section className="card">
        <div className="card-h">
          <h3>Set up costing for "{job.title}"</h3>
          <Link className="btn ghost slim" to="/jobs"><ArrowLeft />Back</Link>
        </div>
        <div className="card-b">
          <p className="muted">This project doesn't have costing set up yet. Existing job data (status, schedule, address) is untouched either way.</p>
          <div className="field">
            <label>Original contract value</label>
            <input
              type="number"
              placeholder={String(job.estimated_value || 0)}
              value={setupContract}
              onChange={e => setSetupContract(e.target.value)}
            />
          </div>
          <button className="btn" disabled={savingSetup} onClick={handleSetup}>
            {savingSetup ? "Setting up..." : "Set up project costing"}
          </button>
        </div>
      </section>
    );
  }

  const minimumMarginPct = pf.minimum_margin_pct ?? settings?.default_minimum_margin_pct ?? 35;
  const contingencyPct = pf.contingency_pct ?? settings?.default_contingency_pct ?? 10;

  const approvedChangeOrdersTotal = changeOrders.filter(co => co.status === "approved").reduce((t, co) => t + Number(co.amount || 0), 0);
  const revenue = contractRevenue(pf.original_contract_value, approvedChangeOrdersTotal, pf.customer_fees, pf.discounts);

  const estimatedLineCosts = items.map(i => Number(i.estimated_cost || 0));
  const estimatedSum = sumEstimatedCost(items);
  const contingencyUsd = (estimatedSum * contingencyPct) / 100;
  const estCost = estimatedTotalCost(estimatedLineCosts, contingencyUsd);

  const actualNet = sumActualNetCost(items); // includes internal (owner labor) cost, for true margin
  const cashPaid = sumCashPaid(items); // real cash out only, for cash-flow math
  const committedUnpaid = sumCommittedUnpaid(items);
  const remainingEstimate = sumRemainingEstimate(items);
  const forecastCost = forecastFinalCost(actualNet, committedUnpaid, remainingEstimate);

  const expProfit = expectedProfit(revenue, estCost);
  const forecastProfitVal = forecastProfit(revenue, forecastCost);
  const minProfitUsd = pf.minimum_profit_usd ?? minimumProfitForMargin(revenue, minimumMarginPct);
  const maxCost = maxAllowedCost(revenue, minimumMarginPct);
  const expMargin = marginPct(expProfit, revenue);
  const forecastMarginVal = marginPct(forecastProfitVal, revenue);
  const remainingBudget = Math.max(0, maxCost - forecastCost);

  // Confirmed customer-payment transactions supersede the Phase 1 manual
  // field once any exist for this job — see the Phase 2 migration's comment.
  const confirmedCustomerPayments = transactions
    .filter(t => t.status === "confirmed" && isCustomerPayment(t.transaction_type))
    .reduce((total, t) => total + Number(t.amount || 0), 0);
  const hasLedgerPayments = transactions.some(t => t.status === "confirmed" && isCustomerPayment(t.transaction_type));
  const paymentsReceived = hasLedgerPayments ? confirmedCustomerPayments : pf.payments_received_manual;
  const balanceDue = Math.max(0, revenue - paymentsReceived);
  const requiredReserve = committedUnpaid + remainingEstimate + contingencyUsd;
  const releasedTotal = profitReleases.reduce((total, r) => total + Number(r.amount || 0), 0);
  // Cash already handed out as a profit release is no longer sitting in the
  // account either — folded into the "paid" side of the formula so it can't
  // be released twice.
  const safeWithdraw = safeToWithdraw(paymentsReceived, cashPaid + releasedTotal, committedUnpaid, remainingEstimate, contingencyUsd);

  const health = evaluateProjectHealth({
    hasEnoughData: revenue > 0,
    forecastProfitValue: forecastProfitVal,
    expectedProfitTarget: expProfit,
    minimumAcceptableProfit: minProfitUsd,
    forecastMarginPctValue: forecastMarginVal,
    minimumMarginPct
  });

  const overBudgetCategories = categoryBudgetUsage(items).filter(c => c.overBy > 0);
  const alerts = [...health.alerts];
  for (const cat of overBudgetCategories) {
    alerts.push(`This project is ${money(cat.overBy)} over the ${titleize(cat.category)} budget.`);
  }
  if (safeWithdraw === 0 && (committedUnpaid + remainingEstimate + contingencyUsd) > paymentsReceived - cashPaid) {
    alerts.push("There is not enough reserved cash to complete this project safely right now.");
  }

  const HealthIcon = HEALTH_ICON[health.status];

  async function handleSaveContract(field: "original_contract_value" | "discounts" | "customer_fees" | "minimum_margin_pct" | "deposit_pct" | "payments_received_manual", value: number) {
    if (!activeCompanyId || !pf) return;
    try {
      await updateProjectFinancials(pf.id, activeCompanyId, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ["project-financials", pf.job_id] });
    } catch (error) {
      toast(errorMessage(error, "Could not save."));
    }
  }

  return (
    <div className="project-financials">
      <div className="between" style={{ marginBottom: 16 }}>
        <Link className="btn ghost slim" to="/jobs"><ArrowLeft />Back to Jobs</Link>
        <h2 style={{ margin: 0 }}>{job.title} — Financials</h2>
        <span />
      </div>

      <section className={`health-banner health-${health.status}`}>
        <HealthIcon />
        <div>
          <b>{HEALTH_LABEL[health.status]}</b>
          {alerts.map((a, i) => <div key={i} className="health-alert">{a}</div>)}
        </div>
      </section>

      <div className="kpis" style={{ marginTop: 16 }}>
        <KpiCard label="Contract Value" value={money(revenue)} hint={`Original ${money(pf.original_contract_value)}`} />
        <KpiCard label="Amount Received" value={money(paymentsReceived)} hint={hasLedgerPayments ? "From confirmed customer payments" : "Manual (no confirmed payments logged yet)"} />
        <KpiCard label="Profit Released" value={money(releasedTotal)} hint={`Safe to release now: ${money(safeWithdraw)}`} />
        <KpiCard label="Balance Due" value={money(balanceDue)} hint="Contract value minus received" />
        <KpiCard label="Estimated Cost" value={money(estCost)} hint={`Incl. ${money(contingencyUsd)} contingency`} />
        <KpiCard label="Actual Net Cost" value={money(actualNet)} hint="Real + internal owner-labor cost" />
        <KpiCard label="Committed Cost" value={money(committedUnpaid)} hint="Ordered/committed, not yet paid" />
        <KpiCard label="Forecast Final Cost" value={money(forecastCost)} hint="Actual + committed + remaining" />
        <KpiCard label="Expected Profit" value={money(expProfit)} hint={`${expMargin.toFixed(1)}% margin`} />
        <KpiCard label="Forecast Profit" value={money(forecastProfitVal)} hint={`${forecastMarginVal.toFixed(1)}% margin`} />
        <KpiCard label="Minimum Profit" value={money(minProfitUsd)} hint={`${minimumMarginPct}% minimum margin policy`} />
        <KpiCard label="Remaining Budget" value={money(remainingBudget)} hint="Spendable before crossing minimum margin" />
        <KpiCard label="Required Cash Reserve" value={money(requiredReserve)} hint="Committed + remaining + contingency" />
        <KpiCard label="Safe to Withdraw" value={money(safeWithdraw)} hint={safeWithdraw === 0 ? "Reserved for pending costs" : "After reserves are covered"} />
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h3>Contract & margin policy</h3></div>
        <div className="card-b">
          <div className="form-row">
            <NumberField label="Original contract value" value={pf.original_contract_value} onSave={v => handleSaveContract("original_contract_value", v)} />
            <NumberField label="Discounts" value={pf.discounts} onSave={v => handleSaveContract("discounts", v)} />
            <NumberField label="Customer fees" value={pf.customer_fees} onSave={v => handleSaveContract("customer_fees", v)} />
            {isOwner ? (
              <NumberField label={`Minimum margin % (company default ${settings?.default_minimum_margin_pct ?? 35}%)`} value={pf.minimum_margin_pct ?? ""} onSave={v => handleSaveContract("minimum_margin_pct", v)} />
            ) : (
              <div className="field">
                <label>Minimum margin %</label>
                <input value={pf.minimum_margin_pct ?? `${settings?.default_minimum_margin_pct ?? 35} (company default)`} disabled />
              </div>
            )}
            <NumberField label="Deposit %" value={pf.deposit_pct} onSave={v => handleSaveContract("deposit_pct", v)} />
            <NumberField label="Payments received (manual)" value={pf.payments_received_manual} onSave={v => handleSaveContract("payments_received_manual", v)} />
          </div>
        </div>
      </section>

      <ChangeOrdersCard
        jobId={job.id}
        companyId={activeCompanyId!}
        changeOrders={changeOrders}
        approverId={session?.user.id || null}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["change-orders", job.id] })}
      />

      <CostLineItemsCard
        jobId={job.id}
        companyId={activeCompanyId!}
        items={items}
        vendors={vendors}
        users={users}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["cost-line-items", job.id] })}
      />

      <TransactionLedgerCard
        jobId={job.id}
        companyId={activeCompanyId!}
        clientId={job.customer_id}
        transactions={transactions}
        vendors={vendors}
        approverId={session?.user.id || null}
        canReverse={isOwner}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["transactions-job", job.id] })}
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

      <ProfitReleaseCard
        jobId={job.id}
        companyId={activeCompanyId!}
        releases={profitReleases}
        health={health}
        safeToWithdrawAmount={safeWithdraw}
        stageRequired={pf.profit_release_stage}
        currentStage={job.status}
        isOwnerUser={isOwner}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["profit-releases", job.id] })}
      />
    </div>
  );
}

function NumberField({ label, value, onSave }: { label: string; value: number | string; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { const n = Number(draft); if (Number.isFinite(n) && n !== Number(value || 0)) onSave(n); }}
      />
    </div>
  );
}

function ChangeOrdersCard({ jobId, companyId, changeOrders, approverId, onChanged }: {
  jobId: string; companyId: string; changeOrders: import("../domain/types").ChangeOrder[]; approverId: string | null; onChanged: () => void;
}) {
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
      toast(errorMessage(error, "Could not add change order."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h3>Change orders</h3></div>
      <div className="card-b">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {changeOrders.map(co => (
                <tr key={co.id}>
                  <td>{co.description}</td>
                  <td>{money(co.amount)}</td>
                  <td><span className={`pill status-${co.status}`}>{co.status}</span></td>
                  <td>
                    {co.status === "draft" && (
                      <>
                        <button className="btn ghost slim" onClick={async () => { await setChangeOrderStatus(co.id, companyId, "approved", approverId); onChanged(); }}>Approve</button>
                        <button className="btn ghost slim" onClick={async () => { await setChangeOrderStatus(co.id, companyId, "rejected", approverId); onChanged(); }}>Reject</button>
                      </>
                    )}
                    <button className="icon-btn" onClick={async () => { await deleteChangeOrder(co.id, companyId); onChanged(); }}><Trash2 /></button>
                  </td>
                </tr>
              ))}
              {changeOrders.length === 0 && <tr><td colSpan={4} className="muted">No change orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="field"><label>Description</label><input value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div className="field"><label>Amount</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />Add change order</button>
      </div>
    </section>
  );
}

const EMPTY_ITEM_FORM = { category: "materials" as CostCategory, description: "", vendorName: "", estimated_cost: "", committed_amount: "", actual_paid: "", tax: "", freight: "", discount: "", returned_amount: "", internal_cost: "", status: "planned" as CostLineItemStatus, responsible_user_id: "", notes: "" };

function CostLineItemsCard({ jobId, companyId, items, vendors, users, onChanged }: {
  jobId: string;
  companyId: string;
  items: import("../domain/types").CostLineItem[];
  vendors: import("../domain/types").Vendor[];
  users: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [form, setForm] = useState(EMPTY_ITEM_FORM);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY_ITEM_FORM>(key: K, value: typeof EMPTY_ITEM_FORM[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function addItem() {
    if (!form.description.trim()) { toast("Description is required."); return; }
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
      toast(errorMessage(error, "Could not add cost item."));
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

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h3>Cost line items</h3></div>
      <div className="card-b">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Category</th><th>Description</th><th>Vendor</th><th>Estimated</th><th>Actual</th><th>Net</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {items.map(item => {
                const vendor = vendors.find(v => v.id === item.vendor_id);
                return (
                  <tr key={item.id}>
                    <td>{titleize(item.category)}</td>
                    <td>{item.description}{item.internal_cost > 0 && <div className="sub">Internal cost: {money(item.internal_cost)}</div>}</td>
                    <td>{vendor?.canonical_name || "—"}</td>
                    <td>{money(item.estimated_cost)}</td>
                    <td>{money(item.actual_paid)}</td>
                    <td>{money(item.net_cost)}</td>
                    <td style={{ minWidth: 160 }}>
                      <Select
                        value={item.status}
                        onChange={v => setStatus(item.id, v as CostLineItemStatus)}
                        options={COST_LINE_ITEM_STATUSES.map(s => ({ value: s, label: titleize(s) }))}
                      />
                    </td>
                    <td><button className="icon-btn" onClick={() => remove(item.id)}><Trash2 /></button></td>
                  </tr>
                );
              })}
              {items.length === 0 && <tr><td colSpan={8} className="muted">No cost items yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Category</label>
            <Select value={form.category} onChange={v => set("category", v as CostCategory)} options={COST_CATEGORIES.map(c => ({ value: c, label: titleize(c) }))} />
          </div>
          <div className="field"><label>Description</label><input value={form.description} onChange={e => set("description", e.target.value)} /></div>
          <div className="field"><label>Vendor</label><input value={form.vendorName} onChange={e => set("vendorName", e.target.value)} placeholder="e.g. The Home Depot" /></div>
          <div className="field"><label>Estimated cost</label><input type="number" value={form.estimated_cost} onChange={e => set("estimated_cost", e.target.value)} /></div>
          <div className="field"><label>Committed amount</label><input type="number" value={form.committed_amount} onChange={e => set("committed_amount", e.target.value)} /></div>
          <div className="field"><label>Actual paid</label><input type="number" value={form.actual_paid} onChange={e => set("actual_paid", e.target.value)} /></div>
          <div className="field"><label>Internal cost (owner/unpaid labor)</label><input type="number" value={form.internal_cost} onChange={e => set("internal_cost", e.target.value)} /></div>
          <div className="field"><label>Tax</label><input type="number" value={form.tax} onChange={e => set("tax", e.target.value)} /></div>
          <div className="field"><label>Freight</label><input type="number" value={form.freight} onChange={e => set("freight", e.target.value)} /></div>
          <div className="field"><label>Discount</label><input type="number" value={form.discount} onChange={e => set("discount", e.target.value)} /></div>
          <div className="field"><label>Returned</label><input type="number" value={form.returned_amount} onChange={e => set("returned_amount", e.target.value)} /></div>
          <div className="field">
            <label>Responsible</label>
            <Select
              value={form.responsible_user_id}
              onChange={v => set("responsible_user_id", v)}
              options={[{ value: "", label: "—" }, ...users.map(u => ({ value: u.id, label: u.name }))]}
            />
          </div>
        </div>
        <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={addItem}><Plus />Add cost item</button>
      </div>
    </section>
  );
}

const EMPTY_TXN_FORM = { transaction_type: "material_purchase" as TransactionType, payee_name: "", description: "", amount: "", sales_tax: "", transaction_date: new Date().toISOString().slice(0, 10), payment_method: "", account: "" };

function TransactionLedgerCard({ jobId, companyId, clientId, transactions, vendors, approverId, canReverse, onChanged }: {
  jobId: string;
  companyId: string;
  clientId: string | null;
  transactions: import("../domain/types").Transaction[];
  vendors: import("../domain/types").Vendor[];
  approverId: string | null;
  canReverse: boolean;
  onChanged: () => void;
}) {
  const [form, setForm] = useState(EMPTY_TXN_FORM);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY_TXN_FORM>(key: K, value: typeof EMPTY_TXN_FORM[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function add() {
    if (!form.amount) { toast("Amount is required."); return; }
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
      toast(errorMessage(error, "Could not add transaction."));
    } finally {
      setSaving(false);
    }
  }

  async function confirm(id: string) {
    try {
      await confirmTransaction(id, companyId, approverId);
      onChanged();
    } catch (error) {
      toast(errorMessage(error, "Could not confirm transaction."));
    }
  }

  async function reverse(txn: import("../domain/types").Transaction) {
    const reason = window.prompt("Reason for reversing this transaction?", "");
    if (reason === null) return;
    try {
      await reverseTransaction(txn, reason || "no reason given");
      toast("Reversal created as a draft — review and confirm it below.");
      onChanged();
    } catch (error) {
      toast(errorMessage(error, "Could not create reversal."));
    }
  }

  async function removeDraft(id: string) {
    await deleteDraftTransaction(id, companyId);
    onChanged();
  }

  const showOwnerHint = OWNER_AMBIGUOUS_TYPES.includes(form.transaction_type) && form.payee_name.trim().length > 0;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h3>Transactions</h3></div>
      <div className="card-b">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Payee</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {transactions.map(t => {
                const vendor = vendors.find(v => v.id === t.vendor_id);
                return (
                  <tr key={t.id}>
                    <td>{t.transaction_date}</td>
                    <td>{TRANSACTION_TYPE_LABELS[t.transaction_type]}</td>
                    <td>{t.payee_name || vendor?.canonical_name || "—"}</td>
                    <td>{t.description}{t.reversal_of && <div className="sub">Reversal of {t.reversal_of}</div>}</td>
                    <td>{money(t.amount)}</td>
                    <td><span className={`pill status-${t.status}`}>{t.status}</span></td>
                    <td>
                      {t.status === "draft" && (
                        <>
                          <button className="btn ghost slim" onClick={() => confirm(t.id)}>Confirm</button>
                          <button className="icon-btn" onClick={() => removeDraft(t.id)}><Trash2 /></button>
                        </>
                      )}
                      {t.status === "confirmed" && !t.reversal_of && canReverse && (
                        <button className="btn ghost slim" onClick={() => reverse(t)}>Reverse</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {transactions.length === 0 && <tr><td colSpan={7} className="muted">No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Type</label>
            <Select
              value={form.transaction_type}
              onChange={v => set("transaction_type", v as TransactionType)}
              options={TRANSACTION_TYPES.map(t => ({ value: t, label: TRANSACTION_TYPE_LABELS[t] }))}
            />
          </div>
          <div className="field"><label>Payee / vendor name</label><input value={form.payee_name} onChange={e => set("payee_name", e.target.value)} /></div>
          <div className="field"><label>Description</label><input value={form.description} onChange={e => set("description", e.target.value)} /></div>
          <div className="field"><label>Amount</label><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} /></div>
          <div className="field"><label>Sales tax</label><input type="number" value={form.sales_tax} onChange={e => set("sales_tax", e.target.value)} /></div>
          <div className="field"><label>Date</label><input type="date" value={form.transaction_date} onChange={e => set("transaction_date", e.target.value)} /></div>
          <div className="field"><label>Payment method</label><input value={form.payment_method} onChange={e => set("payment_method", e.target.value)} /></div>
          <div className="field"><label>Account</label><input value={form.account} onChange={e => set("account", e.target.value)} /></div>
        </div>
        {showOwnerHint && (
          <p className="health-alert" style={{ marginTop: 8 }}>
            Paying an owner? Choose <b>Owner labor payment</b> if this is pay for work performed (reduces this project's profit), or{" "}
            <b>Owner draw / distribution</b> if this is a withdrawal of profit (does not count as a project cost).
          </p>
        )}
        <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />Add transaction (draft)</button>
      </div>
    </section>
  );
}

function RefundsCard({ jobId, companyId, refunds, costLineItems, onChanged }: {
  jobId: string;
  companyId: string;
  refunds: import("../domain/types").Refund[];
  costLineItems: import("../domain/types").CostLineItem[];
  onChanged: () => void;
}) {
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
      toast(errorMessage(error, "Could not add refund."));
    } finally {
      setSaving(false);
    }
  }

  // Marking a refund received also applies it to the linked purchase's
  // returned_amount, so net_cost/margin actually reflect the money back —
  // the original purchase row is never removed, only its returned_amount grows.
  async function markReceived(refund: import("../domain/types").Refund) {
    try {
      await updateRefund(refund.id, companyId, { status: "received", received_date: new Date().toISOString().slice(0, 10) });
      if (refund.cost_line_item_id) {
        const item = costLineItems.find(i => i.id === refund.cost_line_item_id);
        if (item) await updateCostLineItem(item.id, companyId, { returned_amount: Number(item.returned_amount || 0) + Number(refund.amount || 0) });
      }
      onChanged();
    } catch (error) {
      toast(errorMessage(error, "Could not update refund."));
    }
  }

  async function setStatus(refund: import("../domain/types").Refund, status: RefundStatus) {
    if (status === "received") { await markReceived(refund); return; }
    await updateRefund(refund.id, companyId, { status });
    onChanged();
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h3>Refunds & returns</h3></div>
      <div className="card-b">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Description</th><th>Linked purchase</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {refunds.map(r => {
                const linked = costLineItems.find(i => i.id === r.cost_line_item_id);
                return (
                  <tr key={r.id}>
                    <td>{r.description}</td>
                    <td>{linked?.description || "—"}</td>
                    <td>{money(r.amount)}</td>
                    <td style={{ minWidth: 150 }}>
                      <Select value={r.status} onChange={v => setStatus(r, v as RefundStatus)} options={REFUND_STATUSES.map(s => ({ value: s, label: titleize(s) }))} />
                    </td>
                  </tr>
                );
              })}
              {refunds.length === 0 && <tr><td colSpan={4} className="muted">No refunds tracked yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="field"><label>Description</label><input value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div className="field"><label>Amount</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div className="field">
            <label>Linked purchase (optional)</label>
            <Select
              value={costLineItemId}
              onChange={setCostLineItemId}
              options={[{ value: "", label: "—" }, ...costLineItems.map(i => ({ value: i.id, label: i.description || titleize(i.category) }))]}
            />
          </div>
        </div>
        <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={add}><Plus />Add refund</button>
      </div>
    </section>
  );
}

function ProfitReleaseCard({ jobId, companyId, releases, health, safeToWithdrawAmount, stageRequired, currentStage, isOwnerUser, onChanged }: {
  jobId: string;
  companyId: string;
  releases: import("../domain/types").ProfitRelease[];
  health: { status: HealthStatus };
  safeToWithdrawAmount: number;
  stageRequired: string;
  currentStage: string;
  isOwnerUser: boolean;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const stageBlocked = Boolean(stageRequired) && stageRequired !== currentStage;
  const canRelease = isOwnerUser && safeToWithdrawAmount > 0 && !stageBlocked && health.status !== "red";

  async function release() {
    const value = Number(amount || 0);
    if (!value || value > safeToWithdrawAmount) { toast(`Amount must be between $1 and the safe-to-withdraw amount (${money(safeToWithdrawAmount)}).`); return; }
    setSaving(true);
    try {
      await insertProfitRelease({ company_id: companyId, job_id: jobId, amount: value, notes: notes.trim() });
      setAmount(""); setNotes("");
      onChanged();
    } catch (error) {
      toast(errorMessage(error, "Could not release profit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-h"><h3>Profit release</h3></div>
      <div className="card-b">
        {!canRelease && (
          <p className="health-alert">
            {!isOwnerUser
              ? "Only a company owner can release profit."
              : stageBlocked
                ? `Profit release is gated on this project reaching the "${stageRequired}" stage (currently "${currentStage}").`
                : health.status === "red"
                  ? "This project's profit or margin is below the minimum policy — resolve that before releasing profit."
                  : "Nothing is safe to release right now — required costs, commitments, and contingency aren't fully covered yet."}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Amount</th><th>Notes</th></tr></thead>
            <tbody>
              {releases.map(r => (
                <tr key={r.id}><td>{new Date(r.released_at).toLocaleDateString("en-US")}</td><td>{money(r.amount)}</td><td>{r.notes}</td></tr>
              ))}
              {releases.length === 0 && <tr><td colSpan={3} className="muted">No profit released yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {canRelease && (
          <>
            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="field"><label>{`Amount (up to ${money(safeToWithdrawAmount)})`}</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
              <div className="field"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
            </div>
            <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={release}><Plus />Release profit</button>
          </>
        )}
      </div>
    </section>
  );
}
