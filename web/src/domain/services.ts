// The company's service list (company_services), edited on the Services
// screen. It feeds the deal/job/client forms, the Import Center and the
// booking page, in this order. The key is (company_id, service), so a rename
// changes the key, and records using the old name are renamed with it.

export interface ServiceDraft {
  // Name as saved, or null for a row added in this edit.
  original: string | null;
  name: string;
}

export type ServiceProblem = "empty" | "duplicate" | "none";

export const cleanServiceName = (name: string) => name.replace(/\s+/g, " ").trim();

// Codes for the first thing that blocks saving, per row index ("none" =
// the list would be empty).
export function serviceProblems(draft: ServiceDraft[]): { list: ServiceProblem | null; rows: Map<number, ServiceProblem> } {
  const rows = new Map<number, ServiceProblem>();
  const seen = new Map<string, number>();
  draft.forEach((row, i) => {
    const name = cleanServiceName(row.name);
    if (!name) { rows.set(i, "empty"); return; }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) rows.set(i, "duplicate");
    else seen.set(key, i);
  });
  return { list: draft.length ? null : "none", rows };
}

export interface ServicePlan {
  deletes: string[];
  // original -> new name, only rows whose name actually changed.
  renames: [string, string][];
  // The whole list in its new order, for the position upsert.
  final: string[];
}

export function planServiceChanges(saved: string[], draft: ServiceDraft[]): ServicePlan {
  const kept = new Set(draft.map(d => d.original).filter((o): o is string => o !== null));
  return {
    deletes: saved.filter(s => !kept.has(s)),
    renames: draft
      .filter(d => d.original !== null && cleanServiceName(d.name) !== d.original)
      .map(d => [d.original as string, cleanServiceName(d.name)]),
    final: draft.map(d => cleanServiceName(d.name))
  };
}

// Renames run directly, unless a new name is another rename's old name (a
// swap A>B and B>A, or a chain): then they go through placeholder names so
// nothing collides or merges. Direct is preferred, since each pass is a
// real update in the audit log.
export function renamePasses(renames: [string, string][], token = Date.now().toString(36)): [string, string][][] {
  const sources = new Set(renames.map(([from]) => from));
  if (!renames.some(([, to]) => sources.has(to))) return renames.length ? [renames] : [];
  const temp = renames.map((_, i) => `__renaming_${token}_${i}`);
  return [
    renames.map(([from], i) => [from, temp[i]]),
    renames.map(([, to], i) => [temp[i], to])
  ];
}

export function isServiceListChanged(saved: string[], draft: ServiceDraft[]): boolean {
  return draft.length !== saved.length || draft.some((d, i) => d.original !== saved[i] || cleanServiceName(d.name) !== saved[i]);
}
