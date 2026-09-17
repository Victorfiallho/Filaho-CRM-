import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import type { Vendor } from "../domain/types";

export async function listVendors(companyId: string): Promise<Vendor[]> {
  const { data, error } = await supabase.from("vendors").select("*").eq("company_id", companyId).order("canonical_name", { ascending: true });
  if (error) throw error;
  return (data || []) as Vendor[];
}

// Case-insensitive lookup-or-create by canonical name — the normalization
// step the spec asks for ("THE HOME DEPOT #0123" and "Home Depot" -> one
// vendor). Phase 4 (receipt AI) will call this same function so a vendor
// created manually here and one resolved from OCR converge on one row.
export async function findOrCreateVendor(companyId: string, canonicalName: string): Promise<Vendor> {
  const trimmed = canonicalName.trim();
  const { data: existing, error: findError } = await supabase
    .from("vendors")
    .select("*")
    .eq("company_id", companyId)
    .ilike("canonical_name", trimmed)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as Vendor;

  const record = { id: uid("vendor"), company_id: companyId, canonical_name: trimmed, aliases: [], default_category: null, location: "", created_at: now() };
  const { data, error } = await supabase.from("vendors").insert(record).select().single();
  if (error) throw error;
  return data as Vendor;
}

export async function updateVendor(id: string, companyId: string, patch: Partial<Vendor>): Promise<Vendor> {
  const sanitized = { ...patch, updated_at: now() };
  const { data, error } = await supabase.from("vendors").update(sanitized).eq("id", id).eq("company_id", companyId).select().single();
  if (error) throw error;
  return data as Vendor;
}
