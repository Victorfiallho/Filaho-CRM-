import { History, Search } from "lucide-react";
import { useMemo, useState } from "react";
import Select from "../components/Select";
import { useAuditLog, useUsers } from "../data/hooks";
import { titleize } from "../domain/format";
import { useCompany } from "../state/CompanyContext";

const ENTITY_OPTIONS = ["customers", "jobs", "pipeline_stages", "company_access", "user_account", "user_permissions"];
const ACTION_OPTIONS = ["insert", "update", "delete"];

// Read-only view over audit_log — there's no create/edit here, only
// filtering what already happened. Populated by the record_audit_log() DB
// trigger for customers/jobs/pipeline_stages (see
// supabase/migrations/2026-08-31_04_audit_log.sql), and written directly by
// web/api/admin-users.js for company_access/user_account/user_permissions
// (company_members/users have no trigger of their own).
export default function AuditLog() {
  const { activeCompanyId } = useCompany();
  const { data: users = [] } = useUsers();
  const [entityFilter, setEntityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = useMemo(
    () => ({
      entity: entityFilter === "all" ? undefined : entityFilter,
      action: actionFilter === "all" ? undefined : actionFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    }),
    [entityFilter, actionFilter, dateFrom, dateTo]
  );
  const { data: rows = [], isLoading } = useAuditLog(activeCompanyId, filters);

  // audit_log.user_id is an auth.users uuid, not the app-profile `users.id`
  // that userNameById maps elsewhere (RecordModal notes) — match on
  // auth_user_id instead.
  const userNameByAuthId = new Map(users.filter(u => u.auth_user_id).map(u => [u.auth_user_id as string, u.name]));

  return (
    <section className="card">
      <div className="card-h">
        <div>
          <h3>Audit log</h3>
          <div className="sub">{rows.length} event{rows.length === 1 ? "" : "s"}{rows.length === 200 ? " (showing most recent 200 — narrow the filters to see further back)" : ""}</div>
        </div>
      </div>
      <div className="card-b table-filters">
        <Select
          id="entity-filter"
          value={entityFilter}
          onChange={setEntityFilter}
          options={[{ value: "all", label: "All entities" }, ...ENTITY_OPTIONS.map(e => ({ value: e, label: titleize(e) }))]}
        />
        <Select
          id="action-filter"
          value={actionFilter}
          onChange={setActionFilter}
          options={[{ value: "all", label: "All actions" }, ...ACTION_OPTIONS.map(a => ({ value: a, label: titleize(a) }))]}
        />
        <label className="field" style={{ margin: 0 }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="To date" />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Entity</th><th>Action</th><th>Changes</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td className="sub">{new Date(row.created_at).toLocaleString()}</td>
                <td>{userNameByAuthId.get(row.user_id || "") || "System"}</td>
                <td>{titleize(row.entity)} <span className="sub">{row.entity_id}</span></td>
                <td><span className={`pill status-${row.action === "delete" ? "lost" : row.action === "insert" ? "active" : "in-progress"}`}>{row.action}</span></td>
                <td><code style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{JSON.stringify(row.diff)}</code></td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><History />No audit events match these filters</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {isLoading && <div className="empty"><Search />Loading...</div>}
    </section>
  );
}
