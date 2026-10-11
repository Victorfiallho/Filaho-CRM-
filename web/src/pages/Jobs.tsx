import { Briefcase, ChevronDown, ChevronUp, DollarSign, Download, FolderOpen, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Select from "../components/Select";
import { useCurrentAppUser, useCustomers, useIntegrationSettings, useJobs, usePermissions, useUsers } from "../data/hooks";
import { toCSV } from "../domain/csv";
import { filterRowsBySearch } from "../domain/search";
import { formatDay, money, unique } from "../domain/format";
import { filterJobs, localToday, sortJobs, type JobSortKey, type JobWhen } from "../domain/jobFilters";
import type { Job } from "../domain/types";
import { downloadText } from "../lib/downloadText";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

const STATUS_OPTIONS = ["planned", "scheduled", "in progress", "complete"];
const WHEN_OPTIONS: { value: JobWhen; label: string }[] = [
  { value: "all", label: "Any date" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "unscheduled", label: "Unscheduled" }
];
const PAGE_SIZE_OPTIONS = ["12", "25", "50", "100"];

function dash(value: string): string {
  return value.trim() ? value : "—";
}

// Same filter/sort/paginate pattern as Clients (Customers.tsx) — this list
// used to be a bare table of every job with no way to narrow it down.
export default function Jobs() {
  const { activeCompanyId, activeCompany } = useCompany();
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
  const totalValue = rows.reduce((t, j) => t + Number(j.estimated_value || 0), 0);

  function toggleSort(key: JobSortKey) {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortIndicator(key: JobSortKey) {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? <ChevronUp /> : <ChevronDown />;
  }

  function exportCSV() {
    const headers = ["Job", "Status", "Client", "Service", "Date", "Value", "City"];
    const csvRows = rows.map(j => [j.title, j.status || "planned", clientName(j), j.service_type || "", j.scheduled_date || "", String(Number(j.estimated_value || 0)), j.city || ""]);
    downloadText(`${activeCompany?.slug || "jobs"}-jobs.csv`, toCSV(headers, csvRows), "text/csv");
  }

  return (
    <section className="card">
      <div className="card-h">
        <div>
          <h3>Jobs</h3>
          <div className="sub">{allRows.length} job{allRows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="inline-actions">
          {hasPermission("export") && <button className="btn ghost slim" onClick={exportCSV} disabled={!rows.length}><Download />Export</button>}
          {hasPermission("create") && <button className="btn slim" onClick={() => openRecordModal("job")}><Plus />Add job</button>}
        </div>
      </div>
      <div className="card-b table-filters">
        <Select
          id="job-owner-filter"
          value={ownerFilter}
          onChange={setOwnerFilter}
          options={[
            { value: "all", label: "All owners" },
            { value: "mine", label: "My jobs" },
            { value: "unassigned", label: "Unassigned" },
            ...users.map(u => ({ value: u.id, label: u.name }))
          ]}
        />
        <Select id="job-when-filter" value={whenFilter} onChange={v => setWhenFilter(v as JobWhen)} options={WHEN_OPTIONS} />
        <Select
          id="job-status-filter"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: "all", label: "All statuses" }, ...STATUS_OPTIONS.map(s => ({ value: s, label: s }))]}
        />
        <Select
          id="job-service-filter"
          value={serviceFilter}
          onChange={setServiceFilter}
          options={[{ value: "all", label: "All services" }, ...services.map(s => ({ value: s, label: s }))]}
        />
        <span className="sub" style={{ marginLeft: "auto" }}>{rows.length} result{rows.length === 1 ? "" : "s"} · {money(totalValue)}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("title")}><span className="th-sort">Job{sortIndicator("title")}</span></th>
              <th className="sortable" onClick={() => toggleSort("status")}><span className="th-sort">Status{sortIndicator("status")}</span></th>
              <th className="sortable" onClick={() => toggleSort("client")}><span className="th-sort">Client{sortIndicator("client")}</span></th>
              <th className="sortable" onClick={() => toggleSort("date")}><span className="th-sort">Date{sortIndicator("date")}</span></th>
              <th className="sortable" onClick={() => toggleSort("value")}><span className="th-sort">Value{sortIndicator("value")}</span></th>
              <th>Drive</th>
              <th>Financials</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(j => {
              const status = j.status || "planned";
              return (
                <tr key={j.id} className="row-clickable" onClick={() => openRecordModal("job", j)}>
                  <td><b>{j.title}</b><div className="sub">{j.service_type || ""}</div></td>
                  <td><span className={`pill status-${status.replace(/\s+/g, "-")}`}>{status}</span></td>
                  <td>{dash(clientName(j))}</td>
                  <td>{dash(formatDay(j.scheduled_date))}</td>
                  <td>{money(j.estimated_value)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {j.drive_folder_url
                      ? <a href={j.drive_folder_url} target="_blank" rel="noreferrer"><FolderOpen />Folder</a>
                      : driveRootUrl
                        ? <a href={driveRootUrl} target="_blank" rel="noreferrer"><FolderOpen />Link root</a>
                        : <span className="muted">—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <Link to={`/jobs/${j.id}/financials`}><DollarSign />Costing</Link>
                  </td>
                </tr>
              );
            })}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7}><div className="empty"><Briefcase />{allRows.length ? "No jobs match these filters" : "No jobs yet"}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="table-foot">
          <span className="sub">Showing {pageStart + 1}–{Math.min(pageStart + pageSizeNum, rows.length)} of {rows.length} jobs</span>
          <div className="pager">
            <Select
              id="job-page-size"
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
