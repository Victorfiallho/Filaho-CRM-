// Read-only by design: consent_records has no write policy for app users
// and refuses UPDATE/DELETE even server-side.
import { supabase } from "../lib/supabaseClient";
import type { BookingRequest, ConsentRecord, ContactConsentStatus } from "../domain/types";

export async function listConsentRecords(companyId: string, contactId: string): Promise<ConsentRecord[]> {
  const { data, error } = await supabase
    .from("consent_records")
    .select("*")
    .eq("company_id", companyId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as ConsentRecord[];
}

export async function listBookingRequests(companyId: string, by: { leadId?: string; customerId?: string }): Promise<BookingRequest[]> {
  let q = supabase.from("booking_requests").select("*").eq("company_id", companyId);
  // A request with several services made one deal each: match any of them.
  // Quoted so an id with a comma or brace can't break the filter.
  if (by.leadId) {
    const id = `"${by.leadId.replace(/["\\]/g, "\\$&")}"`;
    q = q.or(`lead_id.eq.${id},lead_ids.cs.{${id}}`);
  } else if (by.customerId) q = q.eq("customer_id", by.customerId);
  else return [];
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as BookingRequest[];
}

// One row per client: current SMS/email state, suppression included.
export async function getConsentStatuses(companyId: string): Promise<ContactConsentStatus[]> {
  const { data, error } = await supabase.rpc("get_contact_consent_status", { p_company_id: companyId });
  if (error) throw error;
  return (data || []) as ContactConsentStatus[];
}
