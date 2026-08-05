// The UI (matching app.js's original convention) represents "no coordinate"
// as an empty string, since that worked fine in a localStorage/JSON blob.
// Postgres `numeric` columns don't accept "" — only a real number or NULL —
// so anything crossing into Supabase has to go through this first.
export function toNumericOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Same story for `date`/`timestamptz` columns (e.g. jobs.scheduled_date): an
// empty <input type="date"> value is "", which Postgres rejects the same way
// it rejects "" for numeric columns.
export function toDateOrNull(value: unknown): string | null {
  return value === "" || value === null || value === undefined ? null : String(value);
}
