import { useCustomers } from "../data/hooks";
import { filterRowsBySearch } from "../domain/search";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

export default function Customers() {
  const { activeCompanyId } = useCompany();
  const { data: allRows = [], isLoading } = useCustomers(activeCompanyId);
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const rows = filterRowsBySearch(allRows, searchText);

  return (
    <section className="card">
      <div className="card-h">
        <h3>Client database</h3>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Contact</th><th>Location</th><th>Service</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="sub">{c.source || "Manual"}</div></td>
                <td>{c.phone || c.email || ""}</td>
                <td>{[c.city, c.state, c.zip].filter(Boolean).join(" ")}</td>
                <td>{c.service_type || ""}</td>
                <td><span className="pill">{c.status || "active"}</span></td>
                <td><button className="btn ghost slim" onClick={() => openRecordModal("customer", c)}>Edit</button></td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6}><div className="empty">No clients yet</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
