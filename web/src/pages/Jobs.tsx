import { Briefcase, Calendar, ChevronDown, ChevronsUpDown, ChevronUp, DollarSign, Download, FolderOpen, Plus, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import SearchField from "../components/SearchField";
import Select from "../components/Select";
import { useCurrentAppUser, useCustomers, useIntegrationSettings, useJobs, usePermissions, useUsers } from "../data/hooks";
import { toCSV } from "../domain/csv";
import { filterRowsBySearch } from "../domain/search";
import { formatDay, money, unique } from "../domain/format";
import { filterJobs, localToday, sortJobs, type JobSortKey, type JobWhen } from "../domain/jobFilters";
import { weeklyTrend } from "../domain/trend";
import type { Job } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { downloadText } from "../lib/downloadText";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

const STATUS_OPTIONS = ["planned", "scheduled", "in progress", "complete"];
const WHEN_OPTIONS: JobWhen[] = ["all", "upcoming", "past", "unscheduled"];
const PAGE_SIZE_OPTIONS = ["12", "25", "50", "100"];

// Same filter/sort/paginate pattern as Clients (Customers.tsx).
export default function Jobs() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { t, tn, locale } = useT();
  const { data: allRows = [], isLoading } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const { has: hasPermission } = usePermissions();
  const { data: users = [] } = useUsers();
  const { data: currentAppUser } = useCurrentAppUser();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const driveRootUrl = activeCompanyId ? settings?.google_drive.folder_urls?.[activeCompanyId] : undefined;

  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [whenFilter, setWhenFilter] = useState<JobWhen>("all");
  const [sortKey, setSortKey] = useState<JobSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState("25");
  const [page, setPage] = useState(1);

  const clientNameById = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);
  const clientName = (j: Job) => clientNameById.get(j.customer_id || "") || "";
  const services = useMemo(() => unique(allRows.map(j => j.service_type).filter(Boolean) as string[]), [allRows]);

  const rows = useMemo(() => {
    const searched = filterRowsBySearch(allRows, searchText).filter(j => {
      if (ownerFilter === "mine") return Boolean(currentAppUser) && j.owner_user_id === currentAppUser?.id;
      if (ownerFilter === "unassigned") return !j.owner_user_id;
      if (ownerFilter !== "all") return j.owner_user_id === ownerFilter;
      return true;
    });
    const filtered = filterJobs(searched, { status: statusFilter, service: serviceFilter, when: whenFilter }, localToday());
    return sortJobs(filtered, sortKey, sortDir, j => clientNameById.get(j.customer_id || "") || "");
  }, [allRows, searchText, ownerFilter, currentAppUser, statusFilter, serviceFilter, whenFilter, sortKey, sortDir, clientNameById]);

  useEffect(() => { setPage(1); }, [searchText, ownerFilter, statusFilter, serviceFilter, whenFilter, pageSize]);

  const pageSizeNum = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSizeNum));
  const currentPage = Math.min(page, totalPages);
  const pageStart = rows.length ? (currentPage - 1) * pageSizeNum : 0;
  const pageRows = rows.slice(pageStart, pageStart + pageSizeNum);
  const totalValue = rows.reduce((sum, j) => sum + Number(j.estimated_value || 0), 0);

  function toggleSort(key: JobSortKey) {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: JobSortKey) {
    if (sortKey !== key) return <ChevronsUpDown className="th-sort-idle" aria-hidden="true" />;
    return sortDir === "asc" ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />;
  }

  function exportCSV() {
    const headers = ["Job", "Status", "Client", "Service", "Date", "Value", "City"];
    const csvRows = rows.map(j => [j.title, j.status || "planned", clientName(j), j.service_type || "", j.scheduled_date || "", String(Number(j.estimated_value || 0)), j.city || ""]);
    downloadText(`${activeCompany?.slug || "jobs"}-jobs.csv`, toCSV(headers, csvRows), "text/csv");
  }

  if (isLoading) return <PageSkeleton kpis={4} cards={1} rows={10} fullWidth />;

  const today = localToday();
  const active = rows.filter(j => j.status !== "complete");
  const upcoming = active.filter(j => j.scheduled_date && j.scheduled_date >= today);
  const unscheduled = active.filter(j => !j.scheduled_date);
  const statusLabel = (s: string) => t(`status.${s}` as MessageKey);
  const statusBadge = (j: Job) => {
    const s = j.status || "planned";
    return <span className={`pill status-${s.replace(/\s+/g, "-")}`}>{statusLabel(s)}</span>;
  };
  const missing = (key: MessageKey) => <span className="cell-missing">{t(key)}</span>;
  const linkPills = (j: Job) => (
    <span className="action-pills" onClick={e => e.stopPropagation()}>
      {j.drive_folder_url
        ? <a className="action-pill" href={j.drive_folder_url} target="_blank" rel="noreferrer"><FolderOpen aria-hidden="true" />{t("jobs.folder")}</a>
        : driveRootUrl && <a className="action-pill" href={driveRootUrl} target="_blank" rel="noreferrer"><FolderOpen aria-hidden="true" />{t("jobs.rootFolder")}</a>}
      <Link className="action-pill" to={`/jobs/${j.id}/financials`}><DollarSign aria-hidden="true" />{t("jobs.costing")}</Link>
    </span>
  );
  const columns: { key: JobSortKey; label: string; num?: boolean }[] = [
    { key: "title", label: t("jobs.col.job") },
    { key: "status", label: t("jobs.col.status") },
    { key: "client", label: t("jobs.col.client") },
    { key: "date", label: t("jobs.col.date") },
    { key: "value", label: t("jobs.col.value"), num: true }
  ];

  return (
    <>
      <KpiStrip items={[
        { label: t("jobs.kpi.active"), value: active.length, hint: t("jobs.kpi.activeHint"), tone: "coral", series: weeklyTrend(allRows, j => j.created_at, () => 1, 10).map(p => p.value), seriesLabel: t("jobs.kpi.trend") },
        { label: t("jobs.kpi.upcoming"), value: upcoming.length, hint: t("jobs.kpi.upcomingHint"), tone: "blue" },
        { label: t("jobs.kpi.unscheduled"), value: unscheduled.length, hint: t("jobs.kpi.unscheduledHint"), tone: "amber" },
        { label: t("jobs.kpi.value"), value: money(totalValue), hint: t("jobs.kpi.valueHint"), tone: "green" }
      ]} />

      <section className="card table-card" style={{ marginTop: 20 }}>
        <div className="table-toolbar">
          <div className="table-toolbar-filters">
            <SearchField placeholder={t("search.jobs")} />
            <div className="pill-select">
              <Select
                id="job-owner-filter"
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={[
                  { value: "all", label: t("jobs.allOwners") },
                  { value: "mine", label: t("jobs.mine") },
                  { value: "unassigned", label: t("jobs.unassigned") },
                  ...users.map(u => ({ value: u.id, label: u.name }))
                ]}
              />
            </div>
            <div className="pill-select">
              <Select id="job-when-filter" value={whenFilter} onChange={v => setWhenFilter(v as JobWhen)} options={WHEN_OPTIONS.map(w => ({ value: w, label: t(`jobs.when.${w}` as MessageKey) }))} />
            </div>
            <div className="pill-select">
              <Select
                id="job-status-filter"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "all", label: t("clients.allStatuses") }, ...STATUS_OPTIONS.map(s => ({ value: s, label: statusLabel(s) }))]}
              />
            </div>
            <div className="pill-select">
              <Select
                id="job-service-filter"
                value={serviceFilter}
                onChange={setServiceFilter}
                options={[{ value: "all", label: t("clients.allServices") }, ...services.map(s => ({ value: s, label: s }))]}
              />
            </div>
            <span className="sub">{tn("clients.results", rows.length)} · {money(totalValue)}</span>
          </div>
          <div className="table-toolbar-actions">
            {hasPermission("export") && <button className="btn ghost slim" onClick={exportCSV} disabled={!rows.length}><Download aria-hidden="true" />{t("clients.export")}</button>}
            {hasPermission("create") && <button className="btn slim" onClick={() => openRecordModal("job")}><Plus aria-hidden="true" />{t("jobs.add")}</button>}
          </div>
        </div>

        <div className="table-wrap desktop-only">
          <table className="data-table">
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: 130 }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 120 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key} className={`sortable${col.num ? " num" : ""}`} aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="th-sort" onClick={() => toggleSort(col.key)} aria-label={t("clients.sortBy", { column: col.label })}>
                      {col.label}{sortIndicator(col.key)}
                    </button>
                  </th>
                ))}
                <th>{t("jobs.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(j => (
                <tr key={j.id} className="row-clickable" onClick={() => openRecordModal("job", j)}>
                  <td>
                    <div className="person-cell">
                      <span className="lead-avatar tone-coral" aria-hidden="true"><Briefcase /></span>
                      <div className="person-cell-text">
                        <b>{j.title}</b>
                        <span className="sub">{j.service_type || "—"}</span>
                      </div>
                    </div>
                  </td>
                  <td>{statusBadge(j)}</td>
                  <td>{clientName(j) || missing("jobs.noClient")}</td>
                  <td>{j.scheduled_date ? formatDay(j.scheduled_date, undefined, locale) : missing("jobs.noDate")}</td>
                  <td className="num">{money(j.estimated_value)}</td>
                  <td>{linkPills(j)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="card-list mobile-only">
          {pageRows.map(j => (
            <li key={j.id}>
              <div className="card-list-item" role="button" tabIndex={0} onClick={() => openRecordModal("job", j)} onKeyDown={e => { if (e.key === "Enter") openRecordModal("job", j); }}>
                <span className="lead-avatar tone-coral" aria-hidden="true"><Briefcase /></span>
                <div className="card-list-main">
                  <div className="card-list-top"><b>{j.title}</b>{statusBadge(j)}</div>
                  <div className="card-list-meta">
                    {clientName(j) && <span><User aria-hidden="true" />{clientName(j)}</span>}
                    <span><Calendar aria-hidden="true" />{j.scheduled_date ? formatDay(j.scheduled_date, undefined, locale) : t("jobs.noDate")}</span>
                    <span className="num-strong">{money(j.estimated_value)}</span>
                  </div>
                  {linkPills(j)}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <div className="card-b">
            <EmptyState icon={Briefcase} action={allRows.length === 0 && hasPermission("create") ? <button className="btn slim" onClick={() => openRecordModal("job")}><Plus aria-hidden="true" />{t("jobs.add")}</button> : undefined}>
              {allRows.length ? t("jobs.noMatch") : t("jobs.empty")}
            </EmptyState>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-foot">
            <span className="sub">{t("clients.showing", { from: pageStart + 1, to: Math.min(pageStart + pageSizeNum, rows.length), total: rows.length })}</span>
            <div className="pager">
              <div className="pill-select">
                <Select
                  id="job-page-size"
                  value={pageSize}
                  onChange={setPageSize}
                  options={PAGE_SIZE_OPTIONS.map(n => ({ value: n, label: t("clients.perPage", { count: n }) }))}
                />
              </div>
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{t("clients.prev")}</button>
              <button type="button" className="current" aria-current="page">{currentPage}</button>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{t("clients.next")}</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
