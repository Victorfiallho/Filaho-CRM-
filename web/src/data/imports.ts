import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import type { ImportRecord } from "../domain/types";

export async function listImports(companyId: string): Promise<ImportRecord[]> {
  const { data, error } = await supabase
    .from("imports")
    .select("*")
    .eq("company_id", companyId)
    .order("imported_at", { ascending: false });
  if (error) throw error;
  return (data || []) as ImportRecord[];
}

export async function insertImport(row: Omit<ImportRecord, "id" | "imported_at"> & { imported_at?: string }): Promise<ImportRecord> {
  const record = { id: uid("imp"), imported_at: row.imported_at || now(), ...row };
  const { data, error } = await supabase.from("imports").insert(record).select().single();
  if (error) throw error;
  return data as ImportRecord;
}
