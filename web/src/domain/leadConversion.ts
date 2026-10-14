// Deal > job: a prefilled job draft (client, value, service, lead_id for
// attribution), and the deal's existing job so it isn't converted twice.
import type { Job, Lead } from "./types";

export interface JobDraftFromLead {
  title: string;
  customer_id: string;
  lead_id: string;
  service_type: string;
  estimated_value: number;
  status: string;
}

export function jobDraftFromLead(lead: Lead): JobDraftFromLead {
  const deal = lead.title?.trim() || lead.service_type?.trim();
  const name = lead.name?.trim() || "New client";
  return {
    title: deal ? `${deal} · ${name}` : name,
    customer_id: lead.customer_id || "",
    lead_id: lead.id,
    service_type: lead.service_type || "",
    estimated_value: Number(lead.value || 0),
    status: "planned"
  };
}

export function findJobForLead(leadId: string, jobs: Job[]): Job | undefined {
  return jobs.find(j => j.lead_id === leadId);
}
