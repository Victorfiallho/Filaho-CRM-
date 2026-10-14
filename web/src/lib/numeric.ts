// Forms hold "" for an empty number, which Postgres `numeric` rejects: send
// NULL instead.
export function toNumericOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Same for date/timestamptz columns: an empty date input is "".
export function toDateOrNull(value: unknown): string | null {
  return value === "" || value === null || value === undefined ? null : String(value);
}

// And for optional text and foreign keys (e.g. leads.owner_user_id): an
// unselected dropdown is "", which would fail the foreign key.
export function toTextOrNull(value: unknown): string | null {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s ? s : null;
}
