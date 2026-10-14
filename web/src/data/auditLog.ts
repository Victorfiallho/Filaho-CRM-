import { supabase } from "../lib/supabaseClient";
import type { AuditLogEntry } from "../domain/types";

export interface AuditLogFilters {
  entity?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  // Defaults to 200; the Dashboard feed only needs the latest few.
  limit?: number;
}

// Written only by the record_audit_log() trigger; this module only reads.
// Most recent first, capped at 200 rows.
export async function listAuditLog(companyId: string, filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  let query = supabase
    .from("audit_log")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (filters.entity) query = query.eq("entity", filters.entity);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AuditLogEntry[];
}
