// The top bar search: substring match over a row's main fields.
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
