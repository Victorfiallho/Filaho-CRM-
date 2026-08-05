// Ported verbatim from app.js (pseudoPosition, matchesMapFilters).
import type { MapRecord } from "./types";

export interface MapFilters {
  zip: string;
  city: string;
  service_type: string;
  lead_status: string;
  job_status: string;
  date: string;
}

export const DEFAULT_MAP_FILTERS: MapFilters = { zip: "", city: "", service_type: "all", lead_status: "all", job_status: "all", date: "" };

export function pseudoPosition(record: { zip?: string; city?: string; address?: string }, index: number) {
  const seed = `${record.zip || ""}${record.city || ""}${record.address || ""}${index}`;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { x: 8 + (hash % 82), y: 12 + ((hash >> 8) % 72) };
}

export function matchesMapFilters(record: MapRecord, filters: MapFilters): boolean {
  if (filters.zip && record.zip !== filters.zip) return false;
  if (filters.city && record.city !== filters.city) return false;
  if (filters.service_type !== "all" && record.service_type !== filters.service_type) return false;
  if (filters.lead_status !== "all" && record.kind === "lead" && record.stage_id !== filters.lead_status) return false;
  if (filters.job_status !== "all" && record.kind === "job" && record.status !== filters.job_status) return false;
  if (filters.date && record.kind === "job" && record.scheduled_date !== filters.date) return false;
  if (filters.date && record.kind !== "job") return false;
  return true;
}
