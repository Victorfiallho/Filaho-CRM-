import { supabase } from "../lib/supabaseClient";
import { now } from "../domain/format";
import type { BookingPage, ConsentTextKind, ConsentTextVersion } from "../domain/types";

export async function getBookingPage(companyId: string): Promise<BookingPage | null> {
  const { data, error } = await supabase.from("booking_pages").select("*").eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return (data as BookingPage) || null;
}

export async function createBookingPage(page: Omit<BookingPage, "updated_at">): Promise<BookingPage> {
  const { data, error } = await supabase.from("booking_pages").insert(page).select().single();
  if (error) throw error;
  return data as BookingPage;
}

export async function updateBookingPage(companyId: string, patch: Partial<BookingPage>): Promise<BookingPage> {
  // company_id is the key (and pinned by a trigger), never part of the patch.
  const rest: Partial<BookingPage> = { ...patch };
  delete rest.company_id;
  const { data, error } = await supabase
    .from("booking_pages")
    .update({ ...rest, updated_at: now() })
    .eq("company_id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data as BookingPage;
}

// Every version ever published, newest first — the page always uses the
// newest one per kind.
export async function listConsentTextVersions(companyId: string): Promise<ConsentTextVersion[]> {
  const { data, error } = await supabase
    .from("consent_text_versions")
    .select("*")
    .eq("company_id", companyId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data || []) as ConsentTextVersion[];
}

// Server-side versioning (publish_consent_text RPC): returns the new version
// number, or the current one if the wording didn't change. Old versions are
// never edited — the table refuses UPDATE outright.
export async function publishConsentText(companyId: string, kind: ConsentTextKind, template: string): Promise<number> {
  const { data, error } = await supabase.rpc("publish_consent_text", { p_company_id: companyId, p_kind: kind, p_template: template });
  if (error) throw error;
  return data as number;
}

// Server-rendered preview of the saved page (works while it's inactive),
// for an <iframe srcdoc>. Goes through web/api/book.js with the session
// token, which checks company membership.
export async function fetchBookingPreview(accessToken: string, companyId: string, page: "" | "privacy" | "sms-terms" = ""): Promise<string> {
  const params = new URLSearchParams({ preview: "1", company: companyId, ...(page ? { page } : {}) });
  const res = await fetch(`/api/book?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(res.status === 401 ? "Sign in again to preview." : `Preview failed (${res.status}).`);
  return res.text();
}
