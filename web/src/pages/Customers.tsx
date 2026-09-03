import { ChevronDown, ChevronUp, Download, Mail, MoreVertical, Phone, Plus, Search, Upload, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import Select from "../components/Select";
import { useCustomers, usePermissions } from "../data/hooks";
import { toCSV } from "../domain/csv";
import { initials, relativeDate, unique } from "../domain/format";
import { filterRowsBySearch } from "../domain/search";
import type { Customer } from "../domain/types";
import { downloadText } from "../lib/downloadText";
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

// Three-dot row menu — a small popup portaled to <body> (same pattern as
// Select) so it can float above the table's own overflow:auto scroll
// container instead of being clipped by it.
function RowMenu({ onView }: { onView: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 168) });
    }
    setOpen(v => !v);
  }

  return (
    <div className="row-menu">
      <button ref={btnRef} type="button" className="icon-btn row-menu-trigger" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Row actions">
        <MoreVertical />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="cs-menu row-menu-pop" style={{ position: "fixed", top: pos.top, left: pos.left, width: 168 }}>
          <button type="button" className="cs-option" onClick={e => { e.stopPropagation(); setOpen(false); onView(); }}>View details</button>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Customers() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { data: allRows = [], isLoading } = useCustomers(activeCompanyId);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const navigate = useNavigate();
  const { has: hasPermission } = usePermissions();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState("12");
  const [page, setPage] = useState(1);

  const services = useMemo(() => unique(allRows.map(c => c.service_type).filter(Boolean) as string[]), [allRows]);

  const rows = useMemo(() => {
    let filtered = filterRowsBySearch(allRows, searchText);
    filtered = filterRowsBySearch(filtered, query);
    if (statusFilter !== "all") filtered = filtered.filter(c => (c.status || "active") === statusFilter);
    if (serviceFilter !== "all") filtered = filtered.filter(c => c.service_type === serviceFilter);
    const sorted = [...filtered].sort((a, b) => SORT_VALUE[sortKey](a).localeCompare(SORT_VALUE[sortKey](b)));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [allRows, searchText, query, statusFilter, serviceFilter, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [searchText, query, statusFilter, serviceFilter, pageSize]);

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

  function exportCSV() {
    const headers = ["Name", "Phone", "Email", "City", "State", "Zip", "Service", "Status"];
    const csvRows = rows.map(c => [c.name, c.phone || "", c.email || "", c.city || "", c.state || "", c.zip || "", c.service_type || "", c.status || "active"]);
    downloadText(`${activeCompany?.slug || "clients"}.csv`, toCSV(headers, csvRows), "text/csv");
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
      <div className="card-b table-filters">
        <label className="search-field">
          <Search />
          <input placeholder="Search clients by name, phone, email, or city" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
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
            <col style={{ width: 44 }} />
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
              <th className="col-actions" aria-hidden="true" />
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
                <td className="col-actions" onClick={e => e.stopPropagation()}>
                  <RowMenu onView={() => openRecordModal("customer", c)} />
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8}><div className="empty"><Users />No clients yet</div></td></tr>
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
