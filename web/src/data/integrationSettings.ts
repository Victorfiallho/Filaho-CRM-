import { supabase } from "../lib/supabaseClient";
import type { IntegrationSettings } from "../domain/types";

const DEFAULTS: IntegrationSettings = {
  google_oauth: { enabled: false, client_id: "", project_id: "", javascript_origins: [], scopes: "", connected_at: "", granted_scopes: "", notes: "Import a Google OAuth web client JSON. The client_secret is never stored." },
  google_maps: { enabled: false, api_key: "", notes: "Ready for API key, geocoding, routes, and map embeds." },
  google_calendar: { enabled: false, calendar_ids: {}, notes: "Ready for OAuth and per-company calendar sync." },
  google_sheets: { enabled: false, spreadsheet_ids: {}, notes: "Ready for import/export sync.", source_urls: {} },
  google_drive: { enabled: false, folder_ids: {}, folder_urls: {}, picker_api_key: "", notes: "Ready for project folders and file linking." },
  email_sms: { enabled: false, from_email: "", from_phone: "", notes: "Sends job reminders via Resend (email) and Twilio (SMS)." },
  meta_ads: { enabled: false, ad_account_ids: {}, notes: "Daily ad spend/impressions/clicks sync into Reports." }
};

// Fills keys missing from the stored blob with defaults, so partial or
// first-time rows don't break the Integrations screen.
//
// Read through get_my_integration_settings(): the row is shared by all
// companies, and the RPC strips every per-company entry the caller doesn't
// belong to.
export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  const { data, error } = await supabase.rpc("get_my_integration_settings");
  if (error) throw error;
  const stored = (data || {}) as Partial<IntegrationSettings>;
  return {
    google_oauth: { ...DEFAULTS.google_oauth, ...(stored.google_oauth || {}) },
    google_maps: { ...DEFAULTS.google_maps, ...(stored.google_maps || {}) },
    google_calendar: { ...DEFAULTS.google_calendar, ...(stored.google_calendar || {}) },
    google_sheets: { ...DEFAULTS.google_sheets, ...(stored.google_sheets || {}) },
    google_drive: { ...DEFAULTS.google_drive, ...(stored.google_drive || {}) },
    email_sms: { ...DEFAULTS.email_sms, ...(stored.email_sms || {}) },
    meta_ads: { ...DEFAULTS.meta_ads, ...(stored.meta_ads || {}) }
  };
}

export async function saveIntegrationSettings(settings: IntegrationSettings): Promise<void> {
  const { error } = await supabase.from("integration_settings").upsert({ id: "default", settings });
  if (error) throw error;
}
