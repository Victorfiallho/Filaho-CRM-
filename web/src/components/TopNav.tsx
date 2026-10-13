import { useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, LayoutDashboard, LogOut, Menu, MessageCircle, RefreshCw, Repeat, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { activityWhen, useActivityFeed } from "../data/activityFeed";
import { MODULE_ICONS, MODULES, NAV_GROUPS } from "../domain/constants";
import { avatarInitials } from "../domain/visual";
import type { Company } from "../domain/types";
import { openAssistant } from "./ChatWidget";
import CompanyLogo from "./CompanyLogo";

// Horizontal pill navigation (replaces the icon sidebar). Dashboard is its
// own pill; every other NAV_GROUPS group is a pill with a dropdown. The
// active item — or the group containing it — is the black pill. Below
// 900px the pills collapse into a full-height sheet behind the menu button.

const LAST_SEEN_KEY = "fialho_activity_seen_at";

const labelOf = (id: string) => MODULES.find(m => m[0] === id)?.[1] || id;
const firstSegment = (path: string) => path.replace(/^\//, "").split("/")[0];

// Closes on outside pointer-down and on Escape (returning focus to the
// trigger), and on any route change.
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLElement>("[data-popover-trigger]")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export default function TopNav({ company, canSee, userName, searchText, onSearch, onSwitchCompany, onSignOut }: {
  company: Company;
  canSee: (moduleId: string) => boolean;
  userName: string;
  searchText: string;
  onSearch: (v: string) => void;
  onSwitchCompany: () => void;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = firstSegment(location.pathname);
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setSheetOpen(false); }, [location.pathname]);
  // Modal sheet behavior: Escape closes, Tab cycles inside the sheet, the
  // page behind doesn't scroll, and focus goes back to the menu button.
  useEffect(() => {
    if (!sheetOpen) return;
    const menuBtn = menuBtnRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSheetOpen(false); return; }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusables = [...sheetRef.current.querySelectorAll<HTMLElement>("button, a[href]")];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      menuBtn?.focus();
    };
  }, [sheetOpen]);

  const groups = NAV_GROUPS
    .map(([name, ids]) => [name, ids.filter(id => id !== "dashboard" && canSee(id))] as const)
    .filter(([, ids]) => ids.length > 0);

  return (
    <div className="topnav-wrap">
      <nav className="topnav" aria-label="Main">
        <button className="topnav-brand" onClick={() => navigate("/dashboard")} aria-label={`${company.name} — dashboard`}>
          <span className="logo" data-company={company.id} aria-hidden="true"><CompanyLogo company={company} /></span>
          <span className="topnav-brand-name">{company.name}</span>
        </button>

        <div className="topnav-pills">
          <button className={`nav-pill${current === "dashboard" ? " active" : ""}`} aria-current={current === "dashboard" ? "page" : undefined} onClick={() => navigate("/dashboard")}>
            <LayoutDashboard aria-hidden="true" />Dashboard
          </button>
          {groups.map(([name, ids]) => (
            <NavGroup key={name} name={name} ids={ids} current={current} onPick={id => navigate(`/${id}`)} />
          ))}
        </div>

        <div className="topnav-tools">
          <SearchButton value={searchText} onChange={onSearch} />
          <BellButton />
          <AccountMenu userName={userName} companyName={company.name} onSwitchCompany={onSwitchCompany} onSignOut={onSignOut} />
          <button ref={menuBtnRef} className="round-btn topnav-menu-btn" aria-label="Open menu" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="nav-sheet" role="dialog" aria-modal="true" aria-label="Menu" ref={sheetRef}>
            <div className="nav-sheet-h">
              <span className="topnav-brand-name">{company.name}</span>
              <button className="round-btn" aria-label="Close menu" onClick={() => setSheetOpen(false)} autoFocus><X aria-hidden="true" /></button>
            </div>
            <button className={`nav-sheet-item${current === "dashboard" ? " active" : ""}`} onClick={() => navigate("/dashboard")}>
              <LayoutDashboard aria-hidden="true" />Dashboard
            </button>
            {groups.map(([name, ids]) => (
              <div key={name} className="nav-sheet-group">
                <span className="nav-sheet-label">{name}</span>
                {ids.map(id => {
                  const Icon = MODULE_ICONS[id];
                  return (
                    <button key={id} className={`nav-sheet-item${current === id ? " active" : ""}`} aria-current={current === id ? "page" : undefined} onClick={() => navigate(`/${id}`)}>
                      {Icon && <Icon aria-hidden="true" />}{labelOf(id)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NavGroup({ name, ids, current, onPick }: { name: string; ids: string[]; current: string; onPick: (id: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  const active = ids.includes(current);
  return (
    <div className="nav-group-pop" ref={ref}>
      <button
        data-popover-trigger
        className={`nav-pill${active ? " active" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(v => !v)}
      >
        {active ? labelOf(current) : name}
        <ChevronDown className="nav-pill-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="popover nav-popover">
          <span className="popover-label">{name}</span>
          {ids.map(id => {
            const Icon = MODULE_ICONS[id];
            return (
              <button key={id} className={`popover-item${current === id ? " active" : ""}`} aria-current={current === id ? "page" : undefined} onClick={() => onPick(id)}>
                {Icon && <Icon aria-hidden="true" />}{labelOf(id)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Round button that opens the per-page search field (same searchText every
// page already filters by). Stays expanded while it holds a query.
function SearchButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const expanded = open || Boolean(value);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  return (
    <div className={`topnav-search${expanded ? " open" : ""}`}>
      <button className="round-btn" aria-label="Search this company" aria-expanded={expanded} onClick={() => (expanded ? inputRef.current?.focus() : setOpen(true))}>
        <Search aria-hidden="true" />
      </button>
      {expanded && (
        <input
          ref={inputRef}
          type="search"
          placeholder="Search this company…"
          aria-label="Search this company"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { if (!value) setOpen(false); }}
          onKeyDown={e => { if (e.key === "Escape") { onChange(""); setOpen(false); } }}
        />
      )}
    </div>
  );
}

// Latest activity (bookings, stage moves, payments…) with an unread dot for
// anything newer than the last time the panel was opened on this browser.
function BellButton() {
  const { open, setOpen, ref } = usePopover();
  const { items } = useActivityFeed(8);
  const [seenAt, setSeenAt] = useState(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY) || ""; } catch { return ""; }
  });
  const unread = items.filter(i => i.row.created_at > seenAt).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items[0]) {
      const latest = items[0].row.created_at;
      setSeenAt(latest);
      try { localStorage.setItem(LAST_SEEN_KEY, latest); } catch { /* not persisting is fine */ }
    }
  };

  return (
    <div className="nav-group-pop" ref={ref}>
      <button data-popover-trigger className="round-btn" aria-label={unread ? `Activity, ${unread} new` : "Activity"} aria-expanded={open} onClick={toggle}>
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="round-btn-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover bell-popover">
          <span className="popover-label">Latest activity</span>
          {items.length === 0 && <p className="sub" style={{ padding: "6px 10px" }}>Nothing yet.</p>}
          {items.map(({ row, actor, text }) => (
            <div className="bell-item" key={row.id}>
              <span><b>{actor}</b> {text}</span>
              <span className="sub">{activityWhen(row.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ userName, companyName, onSwitchCompany, onSignOut }: {
  userName: string; companyName: string; onSwitchCompany: () => void; onSignOut: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const queryClient = useQueryClient();
  const item = (icon: ReactNode, label: string, onClick: () => void) => (
    <button className="popover-item" onClick={() => { setOpen(false); onClick(); }}>{icon}{label}</button>
  );
  return (
    <div className="nav-group-pop" ref={ref}>
      <button data-popover-trigger className="avatar-btn" aria-label={`Account: ${userName || "you"}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {avatarInitials(userName)}
      </button>
      {open && (
        <div className="popover account-popover">
          <div className="account-head">
            <b>{userName || "Signed in"}</b>
            <span className="sub">{companyName}</span>
          </div>
          {item(<MessageCircle aria-hidden="true" />, "Ask the assistant", openAssistant)}
          {item(<Repeat aria-hidden="true" />, "Switch company", onSwitchCompany)}
          {item(<RefreshCw aria-hidden="true" />, "Refresh data", () => queryClient.invalidateQueries())}
          {item(<LogOut aria-hidden="true" />, "Log out", onSignOut)}
        </div>
      )}
    </div>
  );
}
