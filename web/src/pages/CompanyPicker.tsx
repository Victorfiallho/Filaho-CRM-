import { Navigate, useNavigate } from "react-router-dom";
import { COMPANY_ICONS } from "../domain/constants";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

export default function CompanyPicker() {
  const { session, signOut } = useAuth();
  const { companies, companiesLoading, selectCompany } = useCompany();
  const navigate = useNavigate();

  if (!session) return <Navigate to="/login" replace />;

  const pick = (id: string) => {
    selectCompany(id);
    navigate("/dashboard");
  };

  return (
    <main className="company-pick">
      <section className="company-panel">
        <div className="between">
          <div>
            <h1>Select company</h1>
            <p className="sub">All records, imports, dashboards, and jobs stay separated by company.</p>
          </div>
          <button className="btn ghost" onClick={() => signOut()}>Logout</button>
        </div>
        <div className="company-grid">
          {companiesLoading && <p className="sub">Loading companies...</p>}
          {!companiesLoading && companies.length === 0 && (
            <p className="sub">No companies are linked to your account yet. Ask an admin to add a company_members row for you.</p>
          )}
          {companies.map(c => (
            <button
              key={c.id}
              className="company-card"
              data-company={c.id}
              style={{ ["--company-color" as any]: c.color || undefined }}
              onClick={() => pick(c.id)}
            >
              <div className="logo" dangerouslySetInnerHTML={{ __html: COMPANY_ICONS[c.id] || c.logo || "" }} />
              <h3 style={{ marginTop: 14 }}>{c.name}</h3>
              <p className="sub">{c.industry} workspace</p>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
