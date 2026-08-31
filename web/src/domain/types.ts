// Row shapes mirror supabase/schema.sql exactly (same table/column names as the
// original FialhoDB localStorage shape documented in schema.md).

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  color: string | null;
  accent: string | null;
  industry: string | null;
  settings: Record<string, unknown>;
  stale_lead_days: number;
}

export interface PipelineStage {
  id: string;
  company_id: string;
  name: string;
  order: number;
  color: string | null;
  type: string | null;
  win_probability: number;
}

export interface Customer {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  status: string;
  service_type: string;
  source: string;
  notes: string;
  drive_folder_url: string;
  lat: number | "" | null;
  lng: number | "" | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  company_id: string;
  customer_id: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  stage_id: string;
  service_type: string;
  value: number;
  source: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  lat: number | "" | null;
  lng: number | "" | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  company_id: string;
  customer_id: string | null;
  lead_id: string | null;
  title: string;
  status: string;
  service_type: string;
  scheduled_date: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  estimated_value: number;
  drive_folder_url: string;
  source?: string;
  source_uid?: string;
  notes?: string;
  customer_name?: string;
  google_event_id?: string | null;
  closed_at?: string | null;
  lat: number | "" | null;
  lng: number | "" | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRecord {
  id: string;
  company_id: string;
  file_name: string;
  source_type: string;
  imported_at: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  row_count: number;
}

export interface IntegrationSettings {
  google_oauth: {
    enabled: boolean;
    client_id: string;
    project_id: string;
    javascript_origins: string[];
    scopes?: string;
    connected_at: string;
    granted_scopes: string;
    notes: string;
  };
  google_maps: { enabled: boolean; api_key: string; notes: string };
  google_calendar: { enabled: boolean; calendar_ids: Record<string, string>; notes: string };
  google_sheets: { enabled: boolean; spreadsheet_ids: Record<string, string>; notes: string; source_urls: Record<string, string> };
  google_drive: { enabled: boolean; folder_ids: Record<string, string>; folder_urls: Record<string, string>; picker_api_key: string; notes: string };
  // Real secrets (Resend/Twilio API keys) live only as Vercel/GitHub Actions
  // env vars (web/api/send-notification.js, scripts/send-reminders.mjs) —
  // never here, since integration_settings is readable by any authenticated
  // user (see google_oauth_tokens' zero-RLS-policy table for the pattern this
  // follows for anything actually secret).
  email_sms: { enabled: boolean; from_email: string; from_phone: string; notes: string };
  meta_ads: { enabled: boolean; ad_account_ids: Record<string, string>; notes: string };
}

export interface RecordNote {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  body: string;
  created_at: string;
  user_id: string | null;
}

export interface RecordFile {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  url: string;
  provider: string | null;
  created_at: string;
}

export interface AppUser {
  id: string;
  name: string;
  auth_user_id: string | null;
}

// Rows below come back from RPCs (get_stagnant_leads, get_funnel_summary,
// get_campaign_roi) — already aggregated/scoped server-side, not raw table
// rows, so their shape mirrors each RPC's `returns table (...)` exactly.

export interface StagnantLead {
  lead_id: string;
  name: string;
  stage_id: string;
  value: number;
  days_in_stage: number;
}

export interface FunnelStageSummary {
  stage_id: string;
  stage_name: string;
  stage_order: number;
  stage_type: string | null;
  lead_count: number;
  total_value: number;
  weighted_forecast: number;
  avg_days_in_stage: number | null;
  conversion_rate: number;
}

export interface CampaignRoi {
  campaign_id: string | null;
  campaign_name: string | null;
  spend: number;
  revenue: number;
  leads_count: number;
  roas: number;
  cpl: number;
}

export interface AuditLogEntry {
  id: string;
  company_id: string;
  user_id: string | null;
  entity: string;
  entity_id: string;
  action: string;
  diff: Record<string, unknown>;
  created_at: string;
}

export type MapKind = "customer" | "lead" | "job";

export interface MapRecord {
  id: string;
  kind: MapKind;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  service_type?: string;
  stage_id?: string;
  status?: string;
  scheduled_date?: string;
  lat: number | "" | null;
  lng: number | "" | null;
}
