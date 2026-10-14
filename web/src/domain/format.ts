// Ported verbatim from app.js — formatting/normalization helpers used across
// dedupe matching, import mapping, and display. No behavior changes.

export const money = (n: unknown) => "$" + Math.round(Number(n || 0)).toLocaleString("en-US");
export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const norm = (v: unknown) => String(v || "").trim();
export const normKey = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const normPhone = (v: unknown) => norm(v).replace(/\D/g, "").slice(-10);
export const normEmail = (v: unknown) => norm(v).toLowerCase();
export const normAddress = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const normZip = (v: unknown) => (norm(v).match(/\d{5}/) || [""])[0];
export const normName = (v: unknown) => norm(v).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

export function titleize(value: unknown) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

export function groupBy<T>(rows: T[], fn: (row: T) => string): Record<string, T[]> {
  return rows.reduce((acc: Record<string, T[]>, row) => {
    const key = fn(row);
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
}

// First initial of the first two words in a name, for avatar badges
// (Pipeline lead cards, Clients table) — "?" when there's nothing to work with.
export function initials(name: string): string {
  const parts = norm(name).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// "Today" / "Yesterday" / "Mon D" for a timestamp — `now` is injectable so
// this stays a pure, testable function instead of reading the real clock.
// `locale` (default en-US) localizes all three: "Hoje" / "Ontem" / "5 de out."
export function relativeDate(iso: string, now: Date = new Date(), locale = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  const relative = (days: number) => {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
    return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
  };
  if (d.toDateString() === now.toDateString()) return relative(0);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return relative(-1);
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

// For date-only YYYY-MM-DD values (jobs.scheduled_date, leads.next_action_date).
// `new Date("2026-10-20")` parses as UTC midnight, which every US time zone
// renders as Oct 19 — so the parts are read as a local calendar date instead.
// Same "Oct 20" style the rest of the app uses; the year only when it isn't
// the current one.
export function formatDay(ymd: string | null | undefined, now: Date = new Date(), locale = "en-US"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(locale, {
    month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

// Date + time for timestamps (notes, audit log, consent history) in the
// CRM's chosen language — `toLocaleString()` with no locale used the
// computer's language instead, so a pt-BR Windows showed "13/10/2026,
// 14:02:11" even with English selected in the app.
export function formatDateTime(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
