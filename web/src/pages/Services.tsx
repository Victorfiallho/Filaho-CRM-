import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, GripVertical, Info, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import PageSkeleton from "../components/PageSkeleton";
import { useCustomers, useJobs, useLeads } from "../data/hooks";
import { saveServices } from "../data/services";
import { bookingPath } from "../domain/booking";
import { cleanServiceName, isServiceListChanged, planServiceChanges, serviceProblems, type ServiceDraft } from "../domain/services";
import { useT } from "../i18n/I18nContext";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";

interface Row extends ServiceDraft {
  key: string;
}

let nextKey = 0;
const toRows = (names: string[]): Row[] => names.map(name => ({ key: `s${nextKey++}`, original: name, name }));

// The company's services: what the deal/job/client forms offer and the
// cards on the booking page, in this order. Edited as a draft and saved
// together, like the pipeline stages.
export default function Services() {
  const { activeCompanyId, services, activeCompany } = useCompany();
  const { t, tn } = useT();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);

  const [rows, setRows] = useState<Row[]>(() => toRows(services));
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  // A fresh list from the server (company switch, save) replaces the draft
  // only while there are no unsaved edits.
  const savedKey = services.join("\u0000");
  const [draftBase, setDraftBase] = useState(savedKey);
  useEffect(() => {
    if (savedKey !== draftBase && !isServiceListChanged(draftBase ? draftBase.split("\u0000") : [], rows)) {
      setRows(toRows(services));
      setDraftBase(savedKey);
    }
  }, [savedKey, draftBase, rows, services]);

  if (!activeCompanyId || leadsLoading || jobsLoading) return <PageSkeleton rows={[6]} />;

  const usage = (name: string) => ({
    leads: leads.filter(l => l.service_type === name).length,
    jobs: jobs.filter(j => j.service_type === name).length,
    clients: customers.filter(c => c.service_type === name).length
  });

  const dirty = isServiceListChanged(services, rows);
  const problems = serviceProblems(rows);
  const blocked = problems.list !== null || problems.rows.size > 0;

  const update = (key: string, name: string) => setRows(r => r.map(row => (row.key === key ? { ...row, name } : row)));
  const add = () => {
    const key = `s${nextKey++}`;
    setRows(r => [...r, { key, original: null, name: "" }]);
    requestAnimationFrame(() => document.getElementById(`svc-${key}`)?.focus());
  };
  const move = (from: number, to: number) => setRows(r => {
    if (to < 0 || to >= r.length || from === to) return r;
    const next = [...r];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  async function remove(row: Row) {
    const used = row.original ? usage(row.original) : null;
    const total = used ? used.leads + used.jobs + used.clients : 0;
    if (total > 0 && !(await confirm({ message: t("svc.removeUsed", { name: row.original!, count: total }), danger: true }))) return;
    setRows(r => r.filter(x => x.key !== row.key));
  }

  async function save() {
    if (!activeCompanyId || blocked) return;
    const plan = planServiceChanges(services, rows);
    const affected = plan.renames.reduce((n, [from]) => { const u = usage(from); return n + u.leads + u.jobs + u.clients; }, 0);
    if (affected > 0 && !(await confirm({ message: tn("svc.renameConfirm", affected) }))) return;
    setSaving(true);
    try {
      await saveServices(activeCompanyId, services, rows);
      const fresh = plan.final;
      setRows(toRows(fresh));
      setDraftBase(fresh.join("\u0000"));
      await queryClient.invalidateQueries({ queryKey: ["services", activeCompanyId] });
      if (plan.renames.length) {
        for (const key of ["leads", "jobs", "customers"]) queryClient.invalidateQueries({ queryKey: [key, activeCompanyId] });
      }
      toast(t("svc.saved"));
    } catch (error) {
      toastError(errorMessage(error, t("svc.saveError")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="services-page">
      <section className="card">
        <div className="card-h">
          <div>
            <h3>{t("svc.title")}</h3>
            <span className="sub">{t("svc.subtitle")}</span>
          </div>
          <a className="action-pill" href={bookingPath(activeCompanyId)} target="_blank" rel="noopener">
            <ExternalLink aria-hidden="true" />{t("svc.viewBooking")}<span className="sr-only"> ({t("nav.opensNewTab")})</span>
          </a>
        </div>
        <div className="card-b">
          <div className="stage-drag-hint"><GripVertical aria-hidden="true" />{t("svc.dragHint")}</div>
          <ol className="stage-rows svc-rows">
            {rows.map((row, i) => {
              const problem = problems.rows.get(i);
              const used = row.original ? usage(row.original) : null;
              const renamed = row.original !== null && cleanServiceName(row.name) !== row.original;
              const parts = used ? [
                used.leads ? tn("svc.usedLeads", used.leads) : "",
                used.jobs ? tn("svc.usedJobs", used.jobs) : "",
                used.clients ? tn("svc.usedClients", used.clients) : ""
              ].filter(Boolean) : [];
              return (
                <li
                  key={row.key}
                  className={`stage-row${dragging === row.key ? " dragging" : ""}`}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const from = rows.findIndex(r => r.key === e.dataTransfer.getData("text/plain")); if (from >= 0) move(from, i); }}
                >
                  <div className="stage-row-lead">
                    <button
                      type="button"
                      className="stage-drag-handle"
                      draggable
                      onDragStart={e => { e.dataTransfer.setData("text/plain", row.key); e.dataTransfer.effectAllowed = "move"; setDragging(row.key); }}
                      onDragEnd={() => setDragging(null)}
                      aria-label={t("svc.dragHandle")}
                    >
                      <GripVertical aria-hidden="true" />
                    </button>
                    <span className="stage-badge type-open" aria-hidden="true">{i + 1}</span>
                    <div className="stage-row-main">
                      <input
                        id={`svc-${row.key}`}
                        value={row.name}
                        onChange={e => update(row.key, e.target.value)}
                        className="stage-name-input"
                        placeholder={t("svc.namePlaceholder")}
                        aria-label={t("svc.name")}
                        aria-invalid={problem ? true : undefined}
                        maxLength={80}
                      />
                      <span className={`sub${problem ? " field-error" : ""}`}>
                        {problem ? t(`svc.problem.${problem}`)
                          : row.original === null ? t("svc.new")
                          : renamed ? t("svc.renamedFrom", { name: row.original })
                          : parts.length ? parts.join(" · ") : t("svc.unused")}
                      </span>
                    </div>
                  </div>
                  <div className="stage-row-controls">
                    <button type="button" className="round-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t("svc.moveUp")}><ArrowUp aria-hidden="true" /></button>
                    <button type="button" className="round-btn" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label={t("svc.moveDown")}><ArrowDown aria-hidden="true" /></button>
                    <button type="button" className="round-btn danger" onClick={() => remove(row)} aria-label={t("svc.remove", { name: row.name || t("svc.name") })} title={t("svc.removeTitle")}><Trash2 aria-hidden="true" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          {problems.list === "none" && <p className="field-error" style={{ marginTop: 10 }}>{t("svc.problem.none")}</p>}
          <button type="button" className="btn ghost stage-add-btn" onClick={add}><Plus aria-hidden="true" />{t("svc.add")}</button>
          <div className="stage-info-banner">
            <Info aria-hidden="true" />
            <div>
              {t("svc.info", { company: activeCompany?.name || "" })}
              <div className="sub" style={{ marginTop: 2 }}>{t("svc.infoSub")}</div>
            </div>
          </div>
        </div>
      </section>

      {dirty && (
        <div className="savebar" role="region" aria-label={t("svc.unsaved")}>
          <span className="sub">{t("svc.unsaved")}</span>
          <button className="btn ghost" onClick={() => { setRows(toRows(services)); setDraftBase(savedKey); }} disabled={saving}>{t("svc.discard")}</button>
          <button className="btn" onClick={save} disabled={saving || blocked}>{saving ? t("svc.saving") : t("svc.save")}</button>
        </div>
      )}
    </div>
  );
}
