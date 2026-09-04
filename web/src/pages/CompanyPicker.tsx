import { ArrowRight, Star } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

// Separate from CompanyContext's own "active company" localStorage key,
// which selectCompany()/clearCompany() manage as session-scoped state and
// which gets *removed* by clearCompany() — exactly when the user lands back
// here via "Switch company". This one is never cleared, purely a UX memory
// of what to highlight next time.
const LAST_COMPANY_KEY = "fialho_last_company_id";

export default function CompanyPicker() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { companies, companiesLoading, selectCompany } = useCompany();
  const navigate = useNavigate();

  // See Shell.tsx's identical guard for why authLoading has to gate this —
  // `session` reads null for a moment on every mount, not just when signed
  // out for real, which used to bounce a hard reload of /companies itself
  // straight to /login.
  if (authLoading) return null;
  if (!session) return <Navigate to="/login" replace />;

  let lastCompanyId: string | null = null;
  try { lastCompanyId = localStorage.getItem(LAST_COMPANY_KEY); } catch { /* private mode etc — just skip the highlight */ }

  const pick = (id: string) => {
    try { localStorage.setItem(LAST_COMPANY_KEY, id); } catch { /* private mode etc */ }
    selectCompany(id);
    navigate("/dashboard");
  };

  return (
    <main className="company-pick">
      <section className="company-panel view-enter">
        <div className="between">
          <div>
            <h1>Select company</h1>
            <p className="sub">Choose a workspace to continue. Your data stays separated by company.</p>
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
              className={`company-card${c.id === lastCompanyId ? " last-opened" : ""}`}
              data-company={c.id}
              style={{ ["--company-color" as any]: c.color || undefined }}
              onClick={() => pick(c.id)}
            >
              {c.id === lastCompanyId && <span className="company-card-badge"><Star />Last opened</span>}
              <div className="company-card-row">
                <div className="logo"><CompanyLogo company={c} /></div>
                <div className="company-card-body">
                  <h3>{c.name}</h3>
                  {c.industry && <span className="pill">{c.industry}</span>}
                </div>
                <span className="company-card-arrow"><ArrowRight /></span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
