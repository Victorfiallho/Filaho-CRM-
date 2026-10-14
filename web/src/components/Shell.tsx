import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import ChatWidget from "./ChatWidget";
import { useCurrentAppUser, useCustomers, useImportsHistory, useIsOwner, useJobs, useLeads, usePermissions } from "../data/hooks";
import { MODULES } from "../domain/constants";
import { readableOn } from "../domain/visual";
import { useT } from "../i18n/I18nContext";
import { navKey } from "../i18n/messages";
import { money } from "../domain/format";
import { isOpenStage } from "../domain/pipelineStages";
import type { PipelineStage } from "../domain/types";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";
import PageHeader from "./PageHeader";
import PageSkeleton from "./PageSkeleton";
import RecordModal from "./RecordModal";
import TopNav from "./TopNav";

// By the first path segment, so nested routes (/jobs/:id/financials) keep
// their section's title.
function pageModuleId(pathname: string): string {
  const id = pathname.replace(/^\//, "").split("/")[0];
  return (MODULES.find(m => m[0] === id) || MODULES[0])[0];
}

// A quick stat for the page subtitle instead of the company name, which the
// top nav already shows.
function useTopbarSubtitle(pathname: string, companyId: string | null, companyName: string, stages: PipelineStage[]): string {
  const { t, tn } = useT();
  const { services } = useCompany();
  const { data: customers = [], isLoading: customersLoading } = useCustomers(companyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(companyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(companyId);
  const { data: imports = [], isLoading: importsLoading } = useImportsHistory(companyId);

  // Blank (the line keeps its height) until the counts load, so "0 clients"
  // never flashes before the real number.
  if (customersLoading || leadsLoading || jobsLoading || importsLoading) return "";

  switch (pathname.replace(/^\//, "").split("/")[0]) {
    case "pipeline": {
      const open = leads.filter(l => isOpenStage(l.stage_id, stages));
      const value = open.reduce((t, l) => t + Number(l.value || 0), 0);
      return t("sub.pipeline", { open: open.length, value: money(value) });
    }
    case "customers":
      return tn("sub.clients", customers.length);
    case "jobs": {
      const scheduled = jobs.filter(j => j.scheduled_date).length;
      return t("sub.jobs", { count: jobs.length, scheduled });
    }
    case "calendar": {
      const scheduled = jobs.filter(j => j.scheduled_date).length;
      return t("sub.calendar", { count: scheduled });
    }
    case "import":
      return imports.length ? tn("sub.imports", imports.length) : t("sub.noImports");
    case "map": {
      const withLocation = [...customers, ...leads, ...jobs].filter((r: any) => r.address || r.city || r.zip).length;
      return t("sub.map", { count: withLocation });
    }
    case "services":
      return tn("sub.services", services.length);
    default:
      return companyName;
  }
}

export default function Shell() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { activeCompany, activeCompanyId, clearCompany, stages, companiesLoading } = useCompany();
  const { isOwner } = useIsOwner();
  const { has: hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { data: currentAppUser } = useCurrentAppUser();
  const { searchText, setSearchText } = useSearch();
  const { openRecordModal } = useModal();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const canImport = hasPermission("import");

  // The search resets on every navigation, so a search typed on one page
  // doesn't silently filter the next.
  useEffect(() => {
    setSearchText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const topbarSubtitle = useTopbarSubtitle(location.pathname, activeCompanyId, activeCompany?.name || "", stages);

  // Set on <body> too: RecordModal is portaled outside the shell, and the
  // accent in styles.css reads --company-color from body. --accent-ink is the
  // readable text color on it. Cleared on unmount so Login/CompanyPicker don't
  // keep a company's color.
  useEffect(() => {
    if (!activeCompany?.color) return;
    document.body.style.setProperty("--company-color", activeCompany.color);
    document.body.style.setProperty("--accent-ink", readableOn(activeCompany.color));
    return () => {
      document.body.style.removeProperty("--company-color");
      document.body.style.removeProperty("--accent-ink");
    };
  }, [activeCompany?.color]);

  // Wait for auth and the companies list before redirecting: on a reload (or
  // a PWA cold start) `session` and `activeCompany` are briefly null even when
  // both are valid, and redirecting then would lose the page being opened.
  if (authLoading || companiesLoading) return <ShellSkeleton />;
  if (!session) return <Navigate to="/login" replace />;
  if (!activeCompanyId || !activeCompany) return <Navigate to="/companies" replace />;
  // The nav and the New button depend on permissions; wait for them instead
  // of showing a short menu that then grows.
  if (permissionsLoading) return <ShellSkeleton />;

  const canSee = (id: string) => (id !== "users" || isOwner) && (id !== "company-financials" || isOwner) && (id !== "import" || canImport);

  const switchCompany = () => {
    clearCompany();
    navigate("/companies");
  };

  return (
    <div className="app-shell" style={{ ["--company-color" as any]: activeCompany.color || undefined }}>
      <TopNav
        company={activeCompany}
        canSee={canSee}
        userName={currentAppUser?.name || session.user.email || ""}
        searchText={searchText}
        onSearch={setSearchText}
        onSwitchCompany={switchCompany}
        onSignOut={() => signOut()}
      />
      <main className="main">
        {/* Exactly one h1 on every render, for screen-reader heading
            navigation; each page's visible title is the PageHeader h2. */}
        <h1 className="sr-only">Fialho Home Improvement: {activeCompany.name}</h1>
        <PageHeader
          title={t(navKey(pageModuleId(location.pathname)))}
          subtitle={topbarSubtitle}
          actions={hasPermission("create") ? <NewRecordMenu onPick={type => openRecordModal(type)} /> : undefined}
        />
        <section className="content" id="view">
          {/* Keyed on the route so this div actually remounts on every
              navigation, replaying .view-enter's fade+rise. */}
          <div key={location.pathname} className="view-enter">
            <Outlet />
          </div>
        </section>
      </main>
      <RecordModal />
      <ChatWidget />
    </div>
  );
}

// One "New" button with a menu instead of three side-by-side buttons.
function NewRecordMenu({ onPick }: { onPick: (type: "lead" | "customer" | "job") => void }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (type: "lead" | "customer" | "job") => { setOpen(false); onPick(type); };

  return (
    <div className="new-menu" ref={wrapRef}>
      <button className="btn accent-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <Plus aria-hidden="true" />{t("new.button")}<ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="popover new-menu-list" role="menu">
          <button role="menuitem" className="popover-item" data-action="new-lead" onClick={() => pick("lead")}>{t("new.lead")}</button>
          <button role="menuitem" className="popover-item" data-action="new-customer" onClick={() => pick("customer")}>{t("new.client")}</button>
          <button role="menuitem" className="popover-item" data-action="new-job" onClick={() => pick("job")}>{t("new.job")}</button>
        </div>
      )}
    </div>
  );
}

// Same outline as the real shell (top nav, page header, content) so the swap
// to real content is a fill-in, not a layout change.
function ShellSkeleton() {
  return (
    <div className="app-shell" aria-busy="true" aria-label="Loading">
      <div className="topnav-wrap">
        <div className="topnav">
          <span className="skeleton skeleton-circle" />
          <div className="topnav-pills">
            {Array.from({ length: 5 }).map((_, i) => <span key={i} className="skeleton skeleton-pill" />)}
          </div>
        </div>
      </div>
      <main className="main">
        <header className="page-header">
          <div className="page-header-text">
            <span className="skeleton skeleton-text short" style={{ display: "block", width: 200, height: 26 }} />
            <span className="skeleton skeleton-text" style={{ display: "block", width: 140, marginTop: 8 }} />
          </div>
        </header>
        <section className="content">
          <PageSkeleton kpis={4} rows={[5, 5]} />
        </section>
      </main>
    </div>
  );
}
