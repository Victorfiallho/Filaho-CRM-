// Read-only from the app, by design: consent_records has no insert/update/
// delete policy for app users (and refuses UPDATE/DELETE even server-side),
// so there is nothing here that writes.
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
  if (by.leadId) q = q.eq("lead_id", by.leadId);
  else if (by.customerId) q = q.eq("customer_id", by.customerId);
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
