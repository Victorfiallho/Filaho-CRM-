import { supabase } from "../lib/supabaseClient";
import type { IntegrationSettings } from "../domain/types";

const DEFAULTS: IntegrationSettings = {
  google_oauth: { enabled: false, client_id: "", project_id: "", javascript_origins: [], scopes: "", connected_at: "", granted_scopes: "", notes: "Import a Google OAuth web client JSON. The client_secret is never stored." },
  google_maps: { enabled: false, api_key: "", notes: "Ready for API key, geocoding, routes, and map embeds." },
  google_calendar: { enabled: false, calendar_ids: {}, notes: "Ready for OAuth and per-company calendar sync." },
  google_sheets: { enabled: false, spreadsheet_ids: {}, notes: "Ready for import/export sync.", source_urls: {} },
  google_drive: { enabled: false, folder_ids: {}, folder_urls: {}, notes: "Ready for project folders and file linking." }
};

// Same defensive merge app.js's migrateDb() did on every load: fill in any key
// missing from the stored blob with the default shape, so older/partial rows
// (or a first-ever row) don't crash the Integrations screen.
export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  const { data, error } = await supabase
    .from("integration_settings")
    .select("settings")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  const stored = (data?.settings || {}) as Partial<IntegrationSettings>;
  return {
    google_oauth: { ...DEFAULTS.google_oauth, ...(stored.google_oauth || {}) },
    google_maps: { ...DEFAULTS.google_maps, ...(stored.google_maps || {}) },
    google_calendar: { ...DEFAULTS.google_calendar, ...(stored.google_calendar || {}) },
    google_sheets: { ...DEFAULTS.google_sheets, ...(stored.google_sheets || {}) },
    google_drive: { ...DEFAULTS.google_drive, ...(stored.google_drive || {}) }
  };
}

export async function saveIntegrationSettings(settings: IntegrationSettings): Promise<void> {
  const { error } = await supabase.from("integration_settings").upsert({ id: "default", settings });
  if (error) throw error;
}
