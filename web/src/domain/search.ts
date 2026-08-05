// Ported verbatim from app.js (filteredRows) — same field list, same substring match.
export function filterRowsBySearch<T>(rows: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return rows;
  return rows.filter(row => {
    const r = row as Record<string, unknown>;
    return [r.name, r.title, r.phone, r.email, r.city, r.zip, r.service_type, r.status].some(v =>
      String(v || "").toLowerCase().includes(q)
    );
  });
}
