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
