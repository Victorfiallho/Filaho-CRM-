// A lead is one deal: the same client can have several in the pipeline
// (a kitchen now, a bathroom later). The deal's own title tells them apart;
// without one, the service names it.
import { isLostStage, isWonStage } from "./pipelineStages";
import type { Lead, PipelineStage } from "./types";

export function dealTitle(lead: Pick<Lead, "title" | "service_type">): string {
  return lead.title?.trim() || lead.service_type?.trim() || "";
}

// A client's deals: open ones first (newest first), then won, then lost.
export function dealsForClient(leads: Lead[], clientId: string, stages: PipelineStage[]): Lead[] {
  const rank = (l: Lead) => (isWonStage(l.stage_id, stages) ? 1 : isLostStage(l.stage_id, stages) ? 2 : 0);
  return leads
    .filter(l => l.customer_id === clientId)
    .sort((a, b) => rank(a) - rank(b) || String(b.created_at).localeCompare(String(a.created_at)));
}
