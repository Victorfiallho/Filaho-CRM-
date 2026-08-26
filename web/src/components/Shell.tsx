import { LogOut, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCustomers, useImportsHistory, useJobs, useLeads } from "../data/hooks";
import { COMPANY_ICONS, COMPANY_LOGOS, MODULE_ICONS, MODULES } from "../domain/constants";
import { money } from "../domain/format";
import { isOpenStage } from "../domain/pipelineStages";
import type { PipelineStage } from "../domain/types";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";
import RecordModal from "./RecordModal";

function pageTitle(pathname: string) {
  const id = pathname.replace(/^\//, "");
  return (MODULES.find(m => m[0] === id) || MODULES[0])[1];
}

// A quick, module-relevant stat instead of just repeating the company name
// (which the sidebar already shows) — makes this header line actually say
// something instead of sitting there static on every page.
function useTopbarSubtitle(pathname: string, companyId: string | null, companyName: string, stages: PipelineStage[]): string {
  const { data: customers = [] } = useCustomers(companyId);
  const { data: leads = [] } = useLeads(companyId);
  const { data: jobs = [] } = useJobs(companyId);
  const { data: imports = [] } = useImportsHistory(companyId);

  switch (pathname.replace(/^\//, "")) {
    case "pipeline": {
      const open = leads.filter(l => isOpenStage(l.stage_id, stages));
      const value = open.reduce((t, l) => t + Number(l.value || 0), 0);
      return `${open.length} open lead${open.length === 1 ? "" : "s"} · ${money(value)} in pipeline`;
    }
    case "customers":
      return `${customers.length} client${customers.length === 1 ? "" : "s"}`;
    case "jobs": {
      const scheduled = jobs.filter(j => j.scheduled_date).length;
      return `${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${scheduled} scheduled`;
    }
    case "calendar": {
      const scheduled = jobs.filter(j => j.scheduled_date).length;
      return `${scheduled} job${scheduled === 1 ? "" : "s"} on the calendar`;
    }
    case "import":
      return imports.length ? `${imports.length} import${imports.length === 1 ? "" : "s"} so far` : "No imports yet";
    case "map": {
      const withLocation = [...customers, ...leads, ...jobs].filter((r: any) => r.address || r.city || r.zip).length;
      return `${withLocation} location${withLocation === 1 ? "" : "s"} on the map`;
    }
    default:
      return companyName;
  }
}

export default function Shell() {
  const { session, signOut } = useAuth();
  const { activeCompany, activeCompanyId, clearCompany, stages } = useCompany();
  const { searchText, setSearchText } = useSearch();
  const { openRecordModal } = useModal();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only collapse to an icon rail (separate from sidebarOpen above,
  // which is the mobile slide-in/out toggle) — persisted so it survives a
  // reload instead of resetting every time.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("fialho_sidebar_collapsed");
      return stored === null ? true : stored === "1"; // collapsed by default until the user opens it once
    } catch { return true; }
  });
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem("fialho_sidebar_collapsed", next ? "1" : "0"); } catch { /* private mode etc — not persisting is fine */ }
    return next;
  });
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement | null>(null);
  const [indicator, setIndicator] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>("button.active");
    if (active) setIndicator({ top: active.offsetTop, height: active.offsetHeight });
  }, [location.pathname]);

  // A search left over from the previous module silently filtering the next
  // one (e.g. searching "Marietta" on Clients, then Jobs looking empty for no
  // visible reason) was confusing enough to change from app.js's original
  // "search persists forever" behavior — it now resets on every navigation.
  useEffect(() => {
    setSearchText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const topbarSubtitle = useTopbarSubtitle(location.pathname, activeCompanyId, activeCompany?.name || "", stages);

  // Also stamped on <body>, not just the .app-shell div below: RecordModal is
  // portaled to #modal-root, a sibling of #root in index.html — outside
  // .app-shell in the DOM — so a CSS variable scoped only to .app-shell would
  // never reach the Save button in that modal. body is a shared ancestor of
  // both, so the brand-color override in styles.css (which reads
  // --company-color off body) reaches everything, portals included. Cleared
  // on unmount so Login/CompanyPicker don't inherit a stale company color
  // after switching companies or logging out.
  useEffect(() => {
    if (!activeCompany?.color) return;
    document.body.style.setProperty("--company-color", activeCompany.color);
    return () => { document.body.style.removeProperty("--company-color"); };
  }, [activeCompany?.color]);

  if (!session) return <Navigate to="/login" replace />;
  if (!activeCompanyId || !activeCompany) return <Navigate to="/companies" replace />;

  const switchCompany = () => {
    clearCompany();
    navigate("/companies");
  };

  return (
    <div className="app-shell" style={{ ["--company-color" as any]: activeCompany.color || undefined, ["--sidebar-w" as any]: collapsed ? "96px" : "264px" }}>
      {/* Always in the DOM (unlike the visible "Fialho Home Improvement" brand
          text below, which the sidebar hides while collapsed) so the app has
          exactly one h1 on every render — screen-reader heading navigation
          otherwise jumped straight from nothing to the topbar's h2. */}
      <h1 className="sr-only">Fialho Home Improvement</h1>
      <aside className={`sidebar${sidebarOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`} id="sidebar">
        <div className="brand">
          <div className="logo" data-company={activeCompany.id}>
            {COMPANY_LOGOS[activeCompany.id]
              ? <img src={COMPANY_LOGOS[activeCompany.id]} alt={activeCompany.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              : <span dangerouslySetInnerHTML={{ __html: COMPANY_ICONS[activeCompany.id] || activeCompany.logo || "" }} />}
          </div>
          {!collapsed && <div><b>Fialho Home Improvement</b><span>{activeCompany.name}</span></div>}
        </div>
        <button className="sidebar-toggle" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <nav className="nav" ref={navRef}>
          <span className="nav-indicator" style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }} />
          {MODULES.map(([id, label]) => {
            const Icon = MODULE_ICONS[id];
            return (
              <button
                key={id}
                className={location.pathname === `/${id}` ? "active" : ""}
                onClick={() => { navigate(`/${id}`); setSidebarOpen(false); }}
                title={collapsed ? label : undefined}
              >
                {Icon && <Icon />}
                {!collapsed && label}
              </button>
            );
          })}
        </nav>
        <div className="side-foot">
          <button className="btn ghost slim" onClick={switchCompany} title={collapsed ? "Switch company" : undefined}>
            <RefreshCw />{!collapsed && "Switch company"}
          </button>
          <button className="btn ghost slim" onClick={() => signOut()} title={collapsed ? "Logout" : undefined}>
            <LogOut />{!collapsed && "Logout"}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(v => !v)}>Menu</button>
          <div>
            <h2>{pageTitle(location.pathname)}</h2>
            <div className="sub">{topbarSubtitle}</div>
          </div>
          <div className="search">
            <input placeholder="Search this company..." value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>
          <button className="btn ghost" data-action="new-lead" onClick={() => openRecordModal("lead")}>New lead</button>
          <button className="btn ghost" data-action="new-customer" onClick={() => openRecordModal("customer")}>New client</button>
          <button className="btn" data-action="new-job" onClick={() => openRecordModal("job")}><Plus />New job</button>
        </header>
        <section className="content" id="view">
          {/* Keyed on the route so this div actually remounts on every
              navigation, replaying .view-enter's fade+rise — previously the
              class sat on the section above, which never remounts (only
              Outlet's child swaps), so the animation only ever played once,
              on first login, and every later page change was an instant cut. */}
          <div key={location.pathname} className="view-enter">
            <Outlet />
          </div>
        </section>
      </main>
      <RecordModal />
    </div>
  );
}
