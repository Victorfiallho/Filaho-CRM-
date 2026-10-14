import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronsUpDown, ChevronUp, Download, Mail, MapPin, Phone, Plus, Trash2, Upload, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import { deleteCustomer } from "../data/customers";
import { useCustomers, useJobs, useLeads, usePermissions } from "../data/hooks";
import { toCSV } from "../domain/csv";
import { clientStanding } from "../domain/deals";
import { initials, relativeDate, unique } from "../domain/format";
import { filterRowsBySearch } from "../domain/search";
import type { Customer } from "../domain/types";
import { downloadText } from "../lib/downloadText";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { useConfirm } from "../state/ConfirmContext";

type SortKey = "name" | "contact" | "location" | "service_type" | "status";

const STATUS_OPTIONS = ["active", "past", "lost"];
const PAGE_SIZE_OPTIONS = ["12", "25", "50", "100"];

const SORT_VALUE: Record<SortKey, (c: Customer) => string> = {
  name: c => c.name || "",
  contact: c => c.phone || c.email || "",
  location: c => [c.city, c.state, c.zip].filter(Boolean).join(" "),
  service_type: c => c.service_type || "",
  status: c => c.status || "active"
};

export default function Customers() {
  const { t, tn, locale } = useT();
  const { confirm } = useConfirm();
  const { activeCompanyId, activeCompany, stages } = useCompany();
  const { data: allRows = [], isLoading } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  // Lead (hasn't closed anything) or Client, and open deals — derived.
  const standing = useMemo(() => clientStanding(leads, jobs, stages), [leads, jobs, stages]);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { has: hasPermission } = usePermissions();

  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState("12");
  const [page, setPage] = useState(1);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const services = useMemo(() => unique(allRows.map(c => c.service_type).filter(Boolean) as string[]), [allRows]);

  const rows = useMemo(() => {
    let filtered = filterRowsBySearch(allRows, searchText);
    if (statusFilter !== "all") filtered = filtered.filter(c => (c.status || "active") === statusFilter);
    if (serviceFilter !== "all") filtered = filtered.filter(c => c.service_type === serviceFilter);
    const sorted = [...filtered].sort((a, b) => SORT_VALUE[sortKey](a).localeCompare(SORT_VALUE[sortKey](b)));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [allRows, searchText, statusFilter, serviceFilter, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [searchText, statusFilter, serviceFilter, pageSize]);

  const pageSizeNum = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSizeNum));
  const currentPage = Math.min(page, totalPages);
  const pageStart = rows.length ? (currentPage - 1) * pageSizeNum : 0;
  const pageRows = rows.slice(pageStart, pageStart + pageSizeNum);

  const allOnPageSelected = pageRows.length > 0 && pageRows.every(c => selected.has(c.id));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <ChevronsUpDown className="th-sort-idle" aria-hidden="true" />;
    return sortDir === "asc" ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />;
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach(c => next.delete(c.id));
      else pageRows.forEach(c => next.add(c.id));
      return next;
    });
  }

  function customersToCSV(list: Customer[]): string {
    const headers = ["Name", "Phone", "Email", "City", "State", "Zip", "Service", "Status"];
    const csvRows = list.map(c => [c.name, c.phone || "", c.email || "", c.city || "", c.state || "", c.zip || "", c.service_type || "", c.status || "active"]);
    return toCSV(headers, csvRows);
  }

  function exportCSV() {
    downloadText(`${activeCompany?.slug || "clients"}.csv`, customersToCSV(rows), "text/csv");
  }

  function exportSelected() {
    const selectedRows = rows.filter(c => selected.has(c.id));
    downloadText(`${activeCompany?.slug || "clients"}-selected.csv`, customersToCSV(selectedRows), "text/csv");
  }

  async function deleteSelected() {
    if (!activeCompanyId || selected.size === 0) return;
    if (!(await confirm({ message: tn("confirm.deleteClients", selected.size), danger: true }))) return;
    setBulkDeleting(true);
    try {
      for (const id of selected) await deleteCustomer(id, activeCompanyId);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
      toast(t("clients.deleted"));
    } catch (error) {
      toastError(errorMessage(error, t("clients.deleteError")));
      queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
    } finally {
      setBulkDeleting(false);
    }
  }

  if (isLoading) return <PageSkeleton cards={1} rows={10} fullWidth />;

  const statusLabel = (s: string) => t(`status.${s}` as MessageKey);
  const missing = <span className="cell-missing">{t("clients.notProvided")}</span>;
  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: t("clients.col.client") },
    { key: "contact", label: t("clients.col.contact") },
    { key: "location", label: t("clients.col.location") },
    { key: "service_type", label: t("clients.col.service") },
    { key: "status", label: t("clients.col.status") }
  ];
  const location = (c: Customer) => [c.city, c.state, c.zip].filter(Boolean).join(" ");
  const contactLink = (c: Customer) =>
    c.phone ? <a className="cell-link" href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}><Phone aria-hidden="true" />{c.phone}</a>
      : c.email ? <a className="cell-link" href={`mailto:${c.email}`} onClick={e => e.stopPropagation()}><Mail aria-hidden="true" />{c.email}</a>
        : missing;
  const statusBadge = (c: Customer) => <span className={`pill status-${c.status || "active"}`}>{statusLabel(c.status || "active")}</span>;
  const kindBadge = (c: Customer) => {
    const kind = standing.get(c.id)?.kind || "lead";
    return <span className={`badge-tone tone-${kind === "client" ? "green" : "blue"} kind-badge`} title={t(`cust.badgeHint.${kind}`)}>{t(`cust.badge.${kind}`)}</span>;
  };
  const openDeals = (c: Customer) => standing.get(c.id)?.open || 0;

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <div className="table-toolbar-filters">
          <div className="pill-select">
            <Select
              id="status-filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: "all", label: t("clients.allStatuses") }, ...STATUS_OPTIONS.map(s => ({ value: s, label: statusLabel(s) }))]}
            />
          </div>
          <div className="pill-select">
            <Select
              id="service-filter"
              value={serviceFilter}
              onChange={setServiceFilter}
              options={[{ value: "all", label: t("clients.allServices") }, ...services.map(s => ({ value: s, label: s }))]}
            />
          </div>
          <span className="sub">{tn("clients.results", rows.length)}</span>
        </div>
        <div className="table-toolbar-actions">
          {hasPermission("import") && <button className="btn ghost slim" onClick={() => navigate("/import")}><Upload aria-hidden="true" />{t("clients.import")}</button>}
          {hasPermission("export") && <button className="btn ghost slim" onClick={exportCSV} disabled={!rows.length}><Download aria-hidden="true" />{t("clients.export")}</button>}
          {hasPermission("create") && <button className="btn slim" onClick={() => openRecordModal("customer")}><Plus aria-hidden="true" />{t("clients.add")}</button>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label={t("clients.selected", { count: selected.size })}>
          <span>{t("clients.selected", { count: selected.size })}</span>
          <div className="inline-actions">
            {hasPermission("export") && <button className="btn ghost slim" onClick={exportSelected}><Download aria-hidden="true" />{t("clients.exportSelected")}</button>}
            {hasPermission("edit") && (
              <button className="btn slim danger" onClick={deleteSelected} disabled={bulkDeleting}>
                <Trash2 aria-hidden="true" />{bulkDeleting ? t("clients.deleting") : t("clients.deleteSelected")}
              </button>
            )}
            <button className="round-btn" onClick={() => setSelected(new Set())} aria-label={t("clients.clearSelection")} title={t("clients.clearSelection")}><X aria-hidden="true" /></button>
          </div>
        </div>
      )}

      {/* Desktop: table. Phones: the same rows as cards (CSS swaps them). */}
      <div className="table-wrap desktop-only">
        <table className="data-table">
          <colgroup>
            <col style={{ width: 48 }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} aria-label={t("clients.selectAll")} />
              </th>
              {columns.map(col => (
                <th key={col.key} className="sortable" aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="th-sort" onClick={() => toggleSort(col.key)} aria-label={t("clients.sortBy", { column: col.label })}>
                    {col.label}{sortIndicator(col.key)}
                  </button>
                </th>
              ))}
              <th>{t("clients.col.activity")}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(c => (
              <tr key={c.id} className="row-clickable" onClick={() => openRecordModal("customer", c)}>
                <td className="col-check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} aria-label={t("clients.select", { name: c.name })} />
                </td>
                <td>
                  <div className="person-cell">
                    <span className="lead-avatar tone-amber" aria-hidden="true">{initials(c.name)}</span>
                    <div className="person-cell-text">
                      <b>{c.name} {kindBadge(c)}</b>
                      <span className="sub">{openDeals(c) ? tn("cust.openDeals", openDeals(c)) : c.email || c.source || "—"}</span>
                    </div>
                  </div>
                </td>
                <td>{contactLink(c)}</td>
                <td>{location(c) || missing}</td>
                <td>{c.service_type || missing}</td>
                <td>{statusBadge(c)}</td>
                <td className="sub">{relativeDate(c.updated_at, new Date(), locale) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="card-list mobile-only">
        {pageRows.map(c => (
          <li key={c.id}>
            <div className="card-list-item" role="button" tabIndex={0} onClick={() => openRecordModal("customer", c)} onKeyDown={e => { if (e.key === "Enter") openRecordModal("customer", c); }}>
              <label className="card-list-check" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} aria-label={t("clients.select", { name: c.name })} />
              </label>
              <span className="lead-avatar tone-amber" aria-hidden="true">{initials(c.name)}</span>
              <div className="card-list-main">
                <div className="card-list-top"><b>{c.name}</b>{kindBadge(c)}</div>
                <div className="card-list-meta">
                  {contactLink(c)}
                  {location(c) && <span><MapPin aria-hidden="true" />{location(c)}</span>}
                  {openDeals(c) > 0 && <span>{tn("cust.openDeals", openDeals(c))}</span>}
                  {c.service_type && <span>{c.service_type}</span>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <div className="card-b">
          <EmptyState icon={Users} action={allRows.length === 0 && hasPermission("create") ? <button className="btn slim" onClick={() => openRecordModal("customer")}><Plus aria-hidden="true" />{t("clients.add")}</button> : undefined}>
            {allRows.length === 0 ? t("clients.empty") : t("clients.noMatch")}
          </EmptyState>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-foot">
          <span className="sub">{t("clients.showing", { from: pageStart + 1, to: Math.min(pageStart + pageSizeNum, rows.length), total: rows.length })}</span>
          <div className="pager">
            <div className="pill-select">
              <Select
                id="page-size"
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
  );
}
