import { ArrowRight, Star } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import CompanyLogo from "../components/CompanyLogo";
import LanguageSwitch from "../components/LanguageSwitch";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

// Which company to highlight next time. Separate from CompanyContext's
// active-company key, which "Switch company" clears.
const LAST_COMPANY_KEY = "fialho_last_company_id";

export default function CompanyPicker() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { companies, companiesLoading, selectCompany } = useCompany();
  const navigate = useNavigate();
  const { t } = useT();

  // Wait for auth (see Shell.tsx): `session` is briefly null on every load.
  if (authLoading) return null;
  if (!session) return <Navigate to="/login" replace />;

  let lastCompanyId: string | null = null;
  try { lastCompanyId = localStorage.getItem(LAST_COMPANY_KEY); } catch { /* storage blocked: no highlight */ }

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
            <h1>{t("company.title")}</h1>
            <p className="sub">{t("company.subtitle")}</p>
          </div>
          <div className="company-panel-tools">
            <LanguageSwitch />
            <button className="btn ghost" onClick={() => signOut()}>{t("company.logout")}</button>
          </div>
        </div>
        <div className="company-grid">
          {companiesLoading && <p className="sub">{t("company.loading")}</p>}
          {!companiesLoading && companies.length === 0 && (
            <p className="sub">{t("company.none")}</p>
          )}
          {companies.map(c => (
            <button
              key={c.id}
              className={`company-card${c.id === lastCompanyId ? " last-opened" : ""}`}
              data-company={c.id}
              style={{ ["--company-color" as any]: c.color || undefined }}
              onClick={() => pick(c.id)}
            >
              {c.id === lastCompanyId && <span className="company-card-badge"><Star aria-hidden="true" />{t("company.lastOpened")}</span>}
              <div className="company-card-row">
                <div className="logo"><CompanyLogo company={c} /></div>
                <div className="company-card-body">
                  <h3>{c.name}</h3>
                  {c.industry && <span className="pill">{c.industry}</span>}
                </div>
                <span className="company-card-arrow" aria-hidden="true"><ArrowRight /></span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
