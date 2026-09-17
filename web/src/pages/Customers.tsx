import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Download, Mail, Phone, Plus, Trash2, Upload, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Select from "../components/Select";
import { deleteCustomer } from "../data/customers";
import { useCustomers, usePermissions } from "../data/hooks";
import { toCSV } from "../domain/csv";
import { initials, relativeDate, unique } from "../domain/format";
import { filterRowsBySearch } from "../domain/search";
import type { Customer } from "../domain/types";
import { downloadText } from "../lib/downloadText";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

type SortKey = "name" | "contact" | "location" | "service_type" | "status";

const STATUS_OPTIONS = ["active", "past", "lost"];
const PAGE_SIZE_OPTIONS = ["12", "25", "50", "100"];

// Empty location/service fields read as broken/missing data rather than
// "not provided yet" — an explicit muted label makes that distinction
// clear instead of leaving a blank cell.
function dash(value: string): React.ReactNode {
  return value.trim() ? value : <span className="muted" style={{ fontStyle: "italic" }}>Not provided</span>;
}

const SORT_VALUE: Record<SortKey, (c: Customer) => string> = {
  name: c => c.name || "",
  contact: c => c.phone || c.email || "",
  location: c => [c.city, c.state, c.zip].filter(Boolean).join(" "),
  service_type: c => c.service_type || "",
  status: c => c.status || "active"
};

export default function Customers() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { data: allRows = [], isLoading } = useCustomers(activeCompanyId);
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
    if (sortKey !== key) return null;
    return sortDir === "asc" ? <ChevronUp /> : <ChevronDown />;
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
    if (!window.confirm(`Delete ${selected.size} client${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      for (const id of selected) await deleteCustomer(id, activeCompanyId);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
      toast("Selected clients deleted.");
    } catch (error) {
      toast(errorMessage(error, "Could not delete every selected client."));
      queryClient.invalidateQueries({ queryKey: ["customers", activeCompanyId] });
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <section className="card">
      <div className="card-h">
        <div>
          <h3>Clients</h3>
          <div className="sub">{allRows.length} client{allRows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="inline-actions">
          {hasPermission("import") && <button className="btn ghost slim" onClick={() => navigate("/import")}><Upload />Import</button>}
          {hasPermission("export") && <button className="btn ghost slim" onClick={exportCSV} disabled={!rows.length}><Download />Export</button>}
          {hasPermission("create") && <button className="btn slim" onClick={() => openRecordModal("customer")}><Plus />Add client</button>}
        </div>
      </div>
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span><b>{selected.size}</b> selected</span>
          <div className="inline-actions">
            {hasPermission("export") && <button className="btn ghost slim" onClick={exportSelected}><Download />Export selected</button>}
            {hasPermission("edit") && (
              <button className="btn ghost slim danger" onClick={deleteSelected} disabled={bulkDeleting}>
                <Trash2 />{bulkDeleting ? "Deleting..." : "Delete selected"}
              </button>
            )}
            <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection" title="Clear selection"><X /></button>
          </div>
        </div>
      )}
      <div className="card-b table-filters">
        <Select
          id="status-filter"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: "all", label: "All statuses" }, ...STATUS_OPTIONS.map(s => ({ value: s, label: s }))]}
        />
        <Select
          id="service-filter"
          value={serviceFilter}
          onChange={setServiceFilter}
          options={[{ value: "all", label: "All services" }, ...services.map(s => ({ value: s, label: s }))]}
        />
        <span className="sub" style={{ marginLeft: "auto" }}>{rows.length} result{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="table-wrap">
        <table>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 260 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} aria-label="Select all clients on this page" />
              </th>
              <th className="sortable" onClick={() => toggleSort("name")}><span className="th-sort">Client{sortIndicator("name")}</span></th>
              <th className="sortable" onClick={() => toggleSort("contact")}><span className="th-sort">Contact{sortIndicator("contact")}</span></th>
              <th className="sortable" onClick={() => toggleSort("location")}><span className="th-sort">Location{sortIndicator("location")}</span></th>
              <th className="sortable" onClick={() => toggleSort("service_type")}><span className="th-sort">Service{sortIndicator("service_type")}</span></th>
              <th className="sortable" onClick={() => toggleSort("status")}><span className="th-sort">Status{sortIndicator("status")}</span></th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(c => (
              <tr key={c.id} className="row-clickable" onClick={() => openRecordModal("customer", c)}>
                <td className="col-check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} aria-label={`Select ${c.name}`} />
                </td>
                <td>
                  <div className="table-avatar-row">
                    <span className="lead-avatar" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>{initials(c.name)}</span>
                    <div><b>{c.name}</b><div className="sub">{c.source || "Manual"}</div></div>
                  </div>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  {c.phone
                    ? <a href={`tel:${c.phone}`}><Phone />{c.phone}</a>
                    : c.email
                      ? <a href={`mailto:${c.email}`}><Mail />{c.email}</a>
                      : dash("")}
                </td>
                <td>{dash([c.city, c.state, c.zip].filter(Boolean).join(" "))}</td>
                <td>{dash(c.service_type || "")}</td>
                <td><span className={`pill status-${c.status || "active"}`}>{c.status || "active"}</span></td>
                <td className="sub">{relativeDate(c.updated_at) || "—"}</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7}><div className="empty"><Users />No clients yet</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="table-foot">
          <span className="sub">Showing {pageStart + 1}–{Math.min(pageStart + pageSizeNum, rows.length)} of {rows.length} clients</span>
          <div className="pager">
            <Select
              id="page-size"
              value={pageSize}
              onChange={setPageSize}
              options={PAGE_SIZE_OPTIONS.map(n => ({ value: n, label: `${n} per page` }))}
            />
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <button type="button" className="current">{currentPage}</button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}
    </section>
  );
}
