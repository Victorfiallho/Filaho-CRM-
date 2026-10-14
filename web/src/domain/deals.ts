// A lead is one deal: the same client can have several in the pipeline
// (a kitchen now, a bathroom later). The deal's own title tells them apart;
// without one, the service names it.
import { isLostStage, isWonStage } from "./pipelineStages";
import type { Lead, PipelineStage } from "./types";

export function dealTitle(lead: Pick<Lead, "title" | "service_type">): string {
  return lead.title?.trim() || lead.service_type?.trim() || "";
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Client search for "who is this deal for?": name or email contains the
// text (accents ignored), or the phone contains its digits. Name-start
// matches first.
export function searchClients<C extends { name: string; phone?: string | null; email?: string | null }>(clients: C[], query: string, limit = 8): C[] {
  const q = fold(query.trim());
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  const scored = clients
    .map(c => {
      const name = fold(c.name || "");
      const hit = name.includes(q) || fold(c.email || "").includes(q) || (digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits));
      return hit ? { c, score: name.startsWith(q) ? 0 : 1 } : null;
    })
    .filter((x): x is { c: C; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map(x => x.c);
}

// How many other deals the same client has, per deal id (for the card chip).
export function otherDealCounts(leads: Pick<Lead, "id" | "customer_id">[]): Map<string, number> {
  const perClient = new Map<string, number>();
  for (const l of leads) if (l.customer_id) perClient.set(l.customer_id, (perClient.get(l.customer_id) || 0) + 1);
  return new Map(leads.map(l => [l.id, l.customer_id ? (perClient.get(l.customer_id) || 1) - 1 : 0]));
}

// "Lead" until the person closes something (a won deal or any job), then
// "client" — derived, never stored. Also their open deals.
export function clientStanding(
  leads: Pick<Lead, "customer_id" | "stage_id">[],
  jobs: { customer_id: string | null }[],
  stages: PipelineStage[]
): Map<string, { kind: "lead" | "client"; open: number }> {
  const out = new Map<string, { kind: "lead" | "client"; open: number }>();
  const get = (id: string) => out.get(id) || out.set(id, { kind: "lead", open: 0 }).get(id)!;
  for (const l of leads) {
    if (!l.customer_id) continue;
    const s = get(l.customer_id);
    if (isWonStage(l.stage_id, stages)) s.kind = "client";
    else if (!isLostStage(l.stage_id, stages)) s.open += 1;
  }
  for (const j of jobs) if (j.customer_id) get(j.customer_id).kind = "client";
  return out;
}

// A client's deals: open ones first (newest first), then won, then lost.
export function dealsForClient(leads: Lead[], clientId: string, stages: PipelineStage[]): Lead[] {
  const rank = (l: Lead) => (isWonStage(l.stage_id, stages) ? 1 : isLostStage(l.stage_id, stages) ? 2 : 0);
  return leads
    .filter(l => l.customer_id === clientId)
    .sort((a, b) => rank(a) - rank(b) || String(b.created_at).localeCompare(String(a.created_at)));
}
