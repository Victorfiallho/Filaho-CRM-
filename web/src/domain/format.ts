// Formatting and normalization helpers for display, duplicate matching and
// imports.

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

// Initials of the first two words, for avatars; "?" when there's nothing.
export function initials(name: string): string {
  const parts = norm(name).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// "Today" / "Yesterday" / "Oct 5" in `locale`. `now` is passed in so tests
// fix the clock.
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

// For date-only YYYY-MM-DD values (scheduled_date, next_action_date).
// new Date("2026-10-20") is UTC midnight, which US time zones show as Oct 19,
// so read the parts as a local date. Year only when not the current one.
export function formatDay(ymd: string | null | undefined, now: Date = new Date(), locale = "en-US"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(locale, {
    month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

// Date and time in the CRM's language, not the computer's.
export function formatDateTime(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
