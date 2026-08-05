import { useCustomers, useIntegrationSettings, useJobs } from "../data/hooks";
import { filterRowsBySearch } from "../domain/search";
import { money } from "../domain/format";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

export default function Jobs() {
  const { activeCompanyId } = useCompany();
  const { data: allRows = [], isLoading } = useJobs(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const rows = filterRowsBySearch(allRows, searchText);
  const driveRootUrl = activeCompanyId ? settings?.google_drive.folder_urls?.[activeCompanyId] : undefined;

  return (
    <section className="card">
      <div className="card-h">
        <h3>Jobs/projects</h3>
        <button className="btn slim" onClick={() => openRecordModal("job")}>Add job</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Job</th><th>Status</th><th>Client</th><th>Date</th><th>Value</th><th>Drive</th><th></th></tr></thead>
          <tbody>
            {rows.map(j => {
              const cust = customers.find(c => c.id === j.customer_id);
              return (
                <tr key={j.id}>
                  <td><b>{j.title}</b><div className="sub">{j.service_type || ""}</div></td>
                  <td><span className="pill">{j.status || "planned"}</span></td>
                  <td>{cust?.name || ""}</td>
                  <td>{j.scheduled_date || ""}</td>
                  <td>{money(j.estimated_value)}</td>
                  <td>
                    {j.drive_folder_url
                      ? <a href={j.drive_folder_url} target="_blank" rel="noreferrer">Folder</a>
                      : driveRootUrl
                        ? <a href={driveRootUrl} target="_blank" rel="noreferrer">Link root</a>
                        : <span className="muted">Not linked</span>}
                  </td>
                  <td><button className="btn ghost slim" onClick={() => openRecordModal("job", j)}>Edit</button></td>
                </tr>
              );
            })}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7}><div className="empty">No jobs yet</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
