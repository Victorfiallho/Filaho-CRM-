import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { COMPANY_ICONS, MODULES } from "../domain/constants";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";
import RecordModal from "./RecordModal";

function pageTitle(pathname: string) {
  const id = pathname.replace(/^\//, "");
  return (MODULES.find(m => m[0] === id) || MODULES[0])[1];
}

export default function Shell() {
  const { session, signOut } = useAuth();
  const { activeCompany, activeCompanyId, clearCompany } = useCompany();
  const { searchText, setSearchText } = useSearch();
  const { openRecordModal } = useModal();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>("button.active");
    if (active) setIndicator({ top: active.offsetTop, height: active.offsetHeight });
  }, [location.pathname]);

  if (!session) return <Navigate to="/login" replace />;
  if (!activeCompanyId || !activeCompany) return <Navigate to="/companies" replace />;

  const switchCompany = () => {
    clearCompany();
    navigate("/companies");
  };

  return (
    <div className="app-shell" style={{ ["--company-color" as any]: activeCompany.color || undefined }}>
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`} id="sidebar">
        <div className="brand">
          <div className="logo" data-company={activeCompany.id} dangerouslySetInnerHTML={{ __html: COMPANY_ICONS[activeCompany.id] || activeCompany.logo || "" }} />
          <div><b>Fialho CRM</b><span>{activeCompany.name}</span></div>
        </div>
        <nav className="nav" ref={navRef}>
          <span className="nav-indicator" style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }} />
          {MODULES.map(([id, label]) => (
            <button
              key={id}
              className={location.pathname === `/${id}` ? "active" : ""}
              onClick={() => { navigate(`/${id}`); setSidebarOpen(false); }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button className="btn ghost slim" onClick={switchCompany}>Switch company</button>
          <button className="btn ghost slim" style={{ marginTop: 8 }} onClick={() => signOut()}>Logout</button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(v => !v)}>Menu</button>
          <div>
            <h2>{pageTitle(location.pathname)}</h2>
            <div className="sub">{activeCompany.name}</div>
          </div>
          <div className="search">
            <input placeholder="Search this company..." value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>
          <button className="btn ghost" data-action="new-lead" onClick={() => openRecordModal("lead")}>New lead</button>
          <button className="btn" data-action="new-customer" onClick={() => openRecordModal("customer")}>New client</button>
        </header>
        <section className="content view-enter" id="view">
          <Outlet />
        </section>
      </main>
      <RecordModal />
    </div>
  );
}
