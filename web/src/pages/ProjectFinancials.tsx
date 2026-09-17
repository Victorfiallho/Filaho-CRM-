import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import KpiCard from "../components/KpiCard";
import PageSkeleton from "../components/PageSkeleton";
import { deleteChangeOrder, insertChangeOrder, setChangeOrderStatus } from "../data/changeOrders";
import { deleteCostLineItem, insertCostLineItem, updateCostLineItem } from "../data/costLineItems";
import {
  useChangeOrders,
  useCostLineItems,
  useFinanceSettings,
  useJobs,
  useProjectFinancials,
  useUsers,
  useVendors
} from "../data/hooks";
import { createProjectFinancials, updateProjectFinancials } from "../data/projectFinancials";
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
import { findOrCreateVendor } from "../data/vendors";
import { money, titleize, uid } from "../domain/format";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { COST_CATEGORIES, COST_LINE_ITEM_STATUSES, type CostCategory, type CostLineItemStatus } from "../domain/types";

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
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const job = jobs.find(j => j.id === jobId);

  const { data: settings, isLoading: settingsLoading } = useFinanceSettings(activeCompanyId);
  const { data: pf, isLoading: pfLoading } = useProjectFinancials(jobId || null);
  const { data: items = [], isLoading: itemsLoading } = useCostLineItems(jobId || null);
  const { data: changeOrders = [], isLoading: coLoading } = useChangeOrders(jobId || null);
  const { data: vendors = [] } = useVendors(activeCompanyId);
  const { data: users = [] } = useUsers();

  const [savingSetup, setSavingSetup] = useState(false);
  const [setupContract, setSetupContract] = useState<string>("");

  const loading = jobsLoading || settingsLoading || pfLoading || itemsLoading || coLoading;
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

  const paymentsReceived = pf.payments_received_manual;
  const balanceDue = Math.max(0, revenue - paymentsReceived);
  const requiredReserve = committedUnpaid + remainingEstimate + contingencyUsd;
  const safeWithdraw = safeToWithdraw(paymentsReceived, cashPaid, committedUnpaid, remainingEstimate, contingencyUsd);

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
        <KpiCard label="Amount Received" value={money(paymentsReceived)} hint="Manual until the ledger (Phase 2) ships" />
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
            <NumberField label={`Minimum margin % (company default ${settings?.default_minimum_margin_pct ?? 35}%)`} value={pf.minimum_margin_pct ?? ""} onSave={v => handleSaveContract("minimum_margin_pct", v)} />
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
                    <td>
                      <select value={item.status} onChange={e => setStatus(item.id, e.target.value as CostLineItemStatus)}>
                        {COST_LINE_ITEM_STATUSES.map(s => <option key={s} value={s}>{titleize(s)}</option>)}
                      </select>
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
            <select value={form.category} onChange={e => set("category", e.target.value as CostCategory)}>
              {COST_CATEGORIES.map(c => <option key={c} value={c}>{titleize(c)}</option>)}
            </select>
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
            <select value={form.responsible_user_id} onChange={e => set("responsible_user_id", e.target.value)}>
              <option value="">—</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn ghost slim" style={{ marginTop: 8 }} disabled={saving} onClick={addItem}><Plus />Add cost item</button>
      </div>
    </section>
  );
}
