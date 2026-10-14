import { Bot, ChevronDown, History } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import Select from "../components/Select";
import { useActivityContext } from "../data/activityFeed";
import { useAuditLog, useIsOwner } from "../data/hooks";
import { describeActivity, fieldLabel, isFinanceActivity, NOISE_FIELDS, type ActivityContext } from "../domain/activity";
import { formatDay, initials, relativeDate } from "../domain/format";
import type { AuditLogEntry } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { en, type MessageKey } from "../i18n/messages";
import { useCompany } from "../state/CompanyContext";

const ENTITY_OPTIONS = ["customers", "leads", "jobs", "pipeline_stages", "booking_requests", "transactions", "cost_line_items", "change_orders", "company_access", "user_account", "user_permissions"];
const FINANCE_OPTIONS = new Set(["transactions", "cost_line_items", "change_orders"]);
const ACTION_OPTIONS = ["insert", "update", "delete"];
const PERIODS = ["7", "30", "90", "all"] as const;
const ACTION_TONE: Record<string, string> = { insert: "green", update: "amber", delete: "rose" };

type Change = { old: unknown; new: unknown };
const isChange = (v: unknown): v is Change =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v) && "old" in (v as object) && "new" in (v as object);

// Human view of audit_log: one sentence per event (same wording as the
// Dashboard feed), grouped by day, with the field changes behind "Details".
// Bookkeeping-only updates (calendar sync ids, coordinates, timestamps) are
// hidden unless asked for.
export default function AuditLog() {
  const { activeCompanyId } = useCompany();
  const { isOwner } = useIsOwner();
  const { t, tn, locale } = useT();
  const { ctx, actorFor } = useActivityContext();
  const [entityFilter, setEntityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("30");
  const [showAuto, setShowAuto] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = useMemo(() => ({
    entity: entityFilter === "all" ? undefined : entityFilter,
    action: actionFilter === "all" ? undefined : actionFilter,
    // Day-rounded so the query key doesn't change on every render.
    dateFrom: period === "all" ? undefined : new Date(new Date().setHours(0, 0, 0, 0) - (Number(period) - 1) * 86400000).toISOString()
  }), [entityFilter, actionFilter, period]);
  const { data: rawRows = [], isLoading } = useAuditLog(activeCompanyId, filters);

  const events = rawRows
    .filter(row => isOwner || !isFinanceActivity(row))
    .map(row => {
      const sentence = describeActivity(row, ctx);
      return { row, actor: actorFor(row), sentence, auto: sentence === null };
    });
  const autoCount = events.filter(e => e.auto).length;
  const visible = events.filter(e => showAuto || !e.auto);

  // Group by local day, newest first. The UTC date (created_at.slice(0, 10))
  // would put a 10pm Atlanta event under the next day.
  const groups: { day: string; label: string; items: typeof visible }[] = [];
  for (const e of visible) {
    const day = new Date(e.row.created_at).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, label: relativeDate(e.row.created_at, new Date(), locale), items: [e] });
  }

  const entityOptions = ENTITY_OPTIONS.filter(e => isOwner || !FINANCE_OPTIONS.has(e));

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <div className="table-toolbar-filters">
          <div className="pill-select">
            <Select id="entity-filter" value={entityFilter} onChange={setEntityFilter}
              options={[{ value: "all", label: t("audit.allEntities") }, ...entityOptions.map(e => ({ value: e, label: t(`audit.entity.${e}` as MessageKey) }))]} />
          </div>
          <div className="pill-select">
            <Select id="action-filter" value={actionFilter} onChange={setActionFilter}
              options={[{ value: "all", label: t("audit.allActions") }, ...ACTION_OPTIONS.map(a => ({ value: a, label: t(`audit.action.${a}` as MessageKey) }))]} />
          </div>
          <div className="pill-select">
            <Select id="period-filter" value={period} onChange={v => setPeriod(v as (typeof PERIODS)[number])}
              options={PERIODS.map(p => ({ value: p, label: t(`audit.period.${p}` as MessageKey) }))} />
          </div>
          <span className="sub">{tn("audit.events", visible.length)}</span>
        </div>
        {autoCount > 0 && (
          <label className="switch-row" title={t("audit.autoHint")}>
            <input type="checkbox" role="switch" checked={showAuto} onChange={e => setShowAuto(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
            <span>{t("audit.showAuto", { count: autoCount })}</span>
          </label>
        )}
      </div>

      {rawRows.length === 200 && <p className="sub audit-capped">{t("audit.capped")}</p>}

      {isLoading ? (
        <div className="card-b skeleton-stack" aria-busy="true" aria-label={t("common.loading")}>
          {Array.from({ length: 8 }).map((_, i) => <span key={i} className="skeleton skeleton-text" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="card-b"><EmptyState icon={History}>{t("audit.empty")}</EmptyState></div>
      ) : (
        <div className="audit-groups">
          {groups.map(group => (
            <section key={group.day} className="audit-group" aria-label={group.label}>
              <h4 className="audit-day">{group.label}</h4>
              <ol className="audit-list">
                {group.items.map(({ row, actor, sentence, auto }) => {
                  const isOpen = openId === row.id;
                  const isSystem = !row.user_id && row.entity !== "booking_requests";
                  return (
                    <li key={row.id} className={`audit-item${auto ? " auto" : ""}`}>
                      <span className={`audit-avatar${isSystem ? " system" : ""}`} aria-hidden="true">{isSystem ? <Bot /> : initials(actor)}</span>
                      <div className="audit-main">
                        <p className="audit-sentence">
                          <b>{actor}</b> {sentence ?? autoSentence(row, ctx)}
                        </p>
                        <div className="audit-meta">
                          <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}</time>
                          <span className={`badge-tone tone-${ACTION_TONE[row.action] || "slate"}`}>{t(`audit.action.${row.action}` as MessageKey)}</span>
                          {`audit.entity.${row.entity}` in en && <span className="chip">{t(`audit.entity.${row.entity}` as MessageKey)}</span>}
                          <button type="button" className="link-btn audit-toggle" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : row.id)}>
                            {isOpen ? t("audit.hideDetails") : t("audit.details")}<ChevronDown aria-hidden="true" />
                          </button>
                        </div>
                        {isOpen && <AuditDetails row={row} ctx={ctx} />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

// Sentence for a bookkeeping-only update (shown only with the switch on).
function autoSentence(row: AuditLogEntry, ctx: ActivityContext): string {
  const t = ctx.t!;
  const fields = Object.entries(row.diff || {}).filter(([, v]) => isChange(v)).map(([f]) => fieldLabel(f, t));
  const name = ctx.nameFor(row.entity, row.entity_id) || t(`audit.entity.${row.entity}` as MessageKey);
  return t("audit.autoChange", { fields: fields.join(", "), name });
}

// Field changes with readable labels and values: stage and owner ids become
// names, dates use the app's format.
function AuditDetails({ row, ctx }: { row: AuditLogEntry; ctx: ActivityContext }) {
  const t = ctx.t!;
  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return t("audit.emptyValue");
    if (field === "stage_id") return ctx.stageName(String(v)) || String(v);
    if (field === "owner_user_id") return ctx.userName(String(v)) || String(v);
    if (field === "status" && `status.${v}` in en) return t(`status.${v}` as MessageKey);
    if (/_date$/.test(field) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return formatDay(String(v), undefined, ctx.locale);
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const entries = Object.entries(row.diff || {}).filter(([f]) => f !== "updated_at" && (row.action !== "update" || !NOISE_FIELDS.has(f) || isChange(row.diff[f])));
  return (
    <div className="audit-details">
      <dl>
        {entries.map(([field, value]) => (
          <div key={field}>
            <dt>{fieldLabel(field, t)}</dt>
            <dd>
              {isChange(value)
                ? <><span className="diff-old">{show(field, value.old)}</span><span className="diff-arrow" aria-hidden="true">→</span><span className="diff-new">{show(field, value.new)}</span></>
                : show(field, value)}
            </dd>
          </div>
        ))}
        <div className="audit-id"><dt>{t("audit.recordId")}</dt><dd><code>{row.entity_id}</code></dd></div>
      </dl>
    </div>
  );
}
