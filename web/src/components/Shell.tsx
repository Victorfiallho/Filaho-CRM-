import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import ChatWidget from "./ChatWidget";
import { useCurrentAppUser, useCustomers, useImportsHistory, useIsOwner, useJobs, useLeads, usePermissions } from "../data/hooks";
import { MODULES } from "../domain/constants";
import { readableOn } from "../domain/visual";
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

// Matches on the first path segment so nested routes keep their section's
// title — /jobs/:id/financials used to fall through to "Dashboard".
function pageTitle(pathname: string) {
  const id = pathname.replace(/^\//, "").split("/")[0];
  return (MODULES.find(m => m[0] === id) || MODULES[0])[1];
}

// A quick, module-relevant stat instead of just repeating the company name
// (which the top nav already shows) — makes the page subtitle actually say
// something instead of sitting there static on every page.
function useTopbarSubtitle(pathname: string, companyId: string | null, companyName: string, stages: PipelineStage[]): string {
  const { data: customers = [], isLoading: customersLoading } = useCustomers(companyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(companyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(companyId);
  const { data: imports = [], isLoading: importsLoading } = useImportsHistory(companyId);

  // Blank (the line keeps its height in CSS) until the counts are real —
  // "0 clients" flashing to "33 clients" read as data appearing out of thin air.
  if (customersLoading || leadsLoading || jobsLoading || importsLoading) return "";

  switch (pathname.replace(/^\//, "").split("/")[0]) {
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
  const { session, loading: authLoading, signOut } = useAuth();
  const { activeCompany, activeCompanyId, clearCompany, stages, companiesLoading } = useCompany();
  const { isOwner } = useIsOwner();
  const { has: hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { data: currentAppUser } = useCurrentAppUser();
  const { searchText, setSearchText } = useSearch();
  const { openRecordModal } = useModal();
  const location = useLocation();
  const navigate = useNavigate();
  const canImport = hasPermission("import");

  // A search left over from the previous module silently filtering the next
  // one (e.g. searching "Marietta" on Clients, then Jobs looking empty for no
  // visible reason) was confusing enough to change from app.js's original
  // "search persists forever" behavior — it now resets on every navigation.
  useEffect(() => {
    setSearchText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const topbarSubtitle = useTopbarSubtitle(location.pathname, activeCompanyId, activeCompany?.name || "", stages);

  // Also stamped on <body>, not just the shell div below: RecordModal is
  // portaled to #modal-root, a sibling of #root in index.html — outside the
  // shell in the DOM — so a CSS variable scoped only to the shell would never
  // reach the Save button in that modal. body is a shared ancestor of both,
  // so the accent override in styles.css (which reads --company-color off
  // body) reaches everything, portals included. --accent-ink is the text
  // color that stays readable on that accent. Cleared on unmount so
  // Login/CompanyPicker don't inherit a stale company color.
  useEffect(() => {
    if (!activeCompany?.color) return;
    document.body.style.setProperty("--company-color", activeCompany.color);
    document.body.style.setProperty("--accent-ink", readableOn(activeCompany.color));
    return () => {
      document.body.style.removeProperty("--company-color");
      document.body.style.removeProperty("--accent-ink");
    };
  }, [activeCompany?.color]);

  // `session` starts null on every mount until AuthContext's getSession()
  // resolves (see its own comment) — bailing on `!session` alone, before
  // `authLoading` confirms that's for real and not just "hasn't checked
  // yet", would redirect a valid signed-in visit to /login on every hard
  // reload. Same reasoning applies to `companiesLoading` below: a hard
  // reload (or, critically, every cold start of the installed PWA/APK)
  // restores activeCompanyId from localStorage synchronously but still
  // needs a real network round-trip for the companies list, so
  // `activeCompany` is momentarily null on that first render regardless —
  // without waiting it out, a perfectly valid, already-selected session got
  // bounced straight to /companies, discarding whatever page it wanted.
  if (authLoading || companiesLoading) return <ShellSkeleton />;
  if (!session) return <Navigate to="/login" replace />;
  if (!activeCompanyId || !activeCompany) return <Navigate to="/companies" replace />;
  // The nav (Company Financials, Users, Import) and the "New" button depend
  // on the user's permissions. Painting before they load showed a short menu
  // that then grew — so the shell waits and shows its own outline instead.
  if (permissionsLoading) return <ShellSkeleton />;

  const canSee = (id: string) => (id !== "users" || isOwner) && (id !== "company-financials" || isOwner) && (id !== "import" || canImport);

  const switchCompany = () => {
    clearCompany();
    navigate("/companies");
  };

  return (
    <div className="app-shell" style={{ ["--company-color" as any]: activeCompany.color || undefined }}>
      {/* Exactly one h1 on every render, for screen-reader heading navigation;
          each page's visible title is the PageHeader h2 below. */}
      <h1 className="sr-only">Fialho Home Improvement — {activeCompany.name}</h1>
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
        <PageHeader
          title={pageTitle(location.pathname)}
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
        <Plus aria-hidden="true" />New<ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="popover new-menu-list" role="menu">
          <button role="menuitem" className="popover-item" data-action="new-lead" onClick={() => pick("lead")}>Lead</button>
          <button role="menuitem" className="popover-item" data-action="new-customer" onClick={() => pick("customer")}>Client</button>
          <button role="menuitem" className="popover-item" data-action="new-job" onClick={() => pick("job")}>Job</button>
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
