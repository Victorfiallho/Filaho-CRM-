// The Calendar's week view: the Sunday-to-Saturday week around a date, as
// local YYYY-MM-DD strings (the same form as jobs.scheduled_date). Local
// dates on purpose: toISOString() is UTC and shifts a day in US evenings.

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function weekStart(anchor: Date): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay());
}

export function weekDays(anchor: Date): string[] {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

export function shiftDays(anchor: Date, days: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + days);
}

// "23 – 29 de nov. de 2026", "Nov 29 – Dec 5, 2026": the locale decides.
export function weekLabel(anchor: Date, locale: string): string {
  const start = weekStart(anchor);
  const end = shiftDays(start, 6);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  return fmt.formatRange ? fmt.formatRange(start, end) : `${fmt.format(start)} – ${fmt.format(end)}`;
}
