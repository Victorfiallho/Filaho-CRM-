// The list search (Pipeline, Clients, Jobs and the top bar share one query).
// Accents and case are ignored, every word must match somewhere ("bob
// kitchen"), and a phone number matches by its digits however it's typed.
const FIELDS = ["name", "title", "phone", "email", "address", "city", "zip", "service_type", "status", "customer_name", "source"];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filterRowsBySearch<T>(rows: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  const phoneQuery = /^[\d\s()+.-]+$/.test(query.trim()) ? query.replace(/\D/g, "") : "";
  return rows.filter(row => {
    const r = row as Record<string, unknown>;
    if (phoneQuery.length >= 4 && String(r.phone ?? "").replace(/\D/g, "").includes(phoneQuery)) return true;
    const text = fold(FIELDS.map(f => String(r[f] ?? "")).join(" "));
    return words.every(w => text.includes(w));
  });
}
