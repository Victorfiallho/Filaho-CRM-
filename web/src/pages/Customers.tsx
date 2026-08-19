import { useMemo, useState } from "react";
import Select from "../components/Select";
import { useCustomers } from "../data/hooks";
import { unique } from "../domain/format";
import { filterRowsBySearch } from "../domain/search";
import type { Customer } from "../domain/types";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

type SortKey = "name" | "contact" | "location" | "service_type" | "status";

const STATUS_OPTIONS = ["active", "past", "lost"];

// Empty fields (no phone/email, no address on file, etc.) read as broken/
// missing data rather than "not provided yet" — an em dash makes the
// distinction explicit instead of leaving a blank cell.
function dash(value: string): string {
  return value.trim() ? value : "—";
}

const SORT_VALUE: Record<SortKey, (c: Customer) => string> = {
  name: c => c.name || "",
  contact: c => c.phone || c.email || "",
  location: c => [c.city, c.state, c.zip].filter(Boolean).join(" "),
  service_type: c => c.service_type || "",
  status: c => c.status || "active"
};

export default function Customers() {
  const { activeCompanyId } = useCompany();
  const { data: allRows = [], isLoading } = useCustomers(activeCompanyId);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();

  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const services = useMemo(() => unique(allRows.map(c => c.service_type).filter(Boolean) as string[]), [allRows]);

  const rows = useMemo(() => {
    let filtered = filterRowsBySearch(allRows, searchText);
    if (statusFilter !== "all") filtered = filtered.filter(c => (c.status || "active") === statusFilter);
    if (serviceFilter !== "all") filtered = filtered.filter(c => c.service_type === serviceFilter);
    const sorted = [...filtered].sort((a, b) => SORT_VALUE[sortKey](a).localeCompare(SORT_VALUE[sortKey](b)));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [allRows, searchText, statusFilter, serviceFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="sort-indicator">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  return (
    <section className="card">
      <div className="card-h">
        <h3>Client database</h3>
      </div>
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
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
              <th className="sortable" onClick={() => toggleSort("contact")}>Contact{sortIndicator("contact")}</th>
              <th className="sortable" onClick={() => toggleSort("location")}>Location{sortIndicator("location")}</th>
              <th className="sortable" onClick={() => toggleSort("service_type")}>Service{sortIndicator("service_type")}</th>
              <th className="sortable" onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="row-clickable" onClick={() => openRecordModal("customer", c)}>
                <td><b>{c.name}</b><div className="sub">{c.source || "Manual"}</div></td>
                <td>{dash(c.phone || c.email || "")}</td>
                <td>{dash([c.city, c.state, c.zip].filter(Boolean).join(" "))}</td>
                <td>{dash(c.service_type || "")}</td>
                <td><span className={`pill status-${c.status || "active"}`}>{c.status || "active"}</span></td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty">No clients yet</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
