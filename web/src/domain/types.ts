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
  // Only populated by getCurrentAppUser() (the signed-in user's own row, for
  // permission checks) — listUsers()'s lookup select doesn't fetch it, so
  // any AppUser sourced from that list won't have this set.
  permissions?: string[];
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

// ── Project Costing & Financial Control (Phase 1) ───────────────────────
// Every "project" below IS a `jobs` row (job_id) — no parallel project
// entity. A job with no matching ProjectFinancials row simply hasn't had
// the costing module set up yet.

export interface CompanyFinanceSettings {
  company_id: string;
  default_minimum_margin_pct: number;
  default_deposit_pct: number;
  default_contingency_pct: number;
  created_at: string;
  updated_at: string;
}

export interface DepositScheduleStep {
  label: string;
  pct: number;
}

export interface ProjectFinancials {
  id: string;
  company_id: string;
  job_id: string;
  original_contract_value: number;
  discounts: number;
  customer_fees: number;
  minimum_margin_pct: number | null;
  desired_margin_pct: number | null;
  minimum_profit_usd: number | null;
  contingency_pct: number | null;
  deposit_pct: number;
  deposit_schedule: DepositScheduleStep[];
  payments_received_manual: number;
  start_date: string | null;
  target_completion_date: string | null;
  profit_release_stage: string;
  created_at: string;
  updated_at: string;
}

export type ChangeOrderStatus = "draft" | "approved" | "rejected";

export interface ChangeOrder {
  id: string;
  company_id: string;
  job_id: string;
  description: string;
  amount: number;
  status: ChangeOrderStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  company_id: string;
  canonical_name: string;
  aliases: string[];
  default_category: string | null;
  location: string;
  created_at: string;
  updated_at: string;
}

export const COST_CATEGORIES = [
  "materials", "subcontractor_labor", "employee_labor", "owner_labor",
  "plumbing", "electrical", "countertop", "cabinets", "flooring",
  "tile_backsplash", "painting", "cleaning", "delivery_freight",
  "equipment_rental", "tools_consumables", "permits_fees", "disposal",
  "fuel_mileage", "payment_processing_fees", "contingency", "other"
] as const;
export type CostCategory = typeof COST_CATEGORIES[number];

export const COST_LINE_ITEM_STATUSES = [
  "planned", "quoted", "approved", "ordered", "committed", "partially_paid",
  "paid", "returned", "partially_refunded", "fully_refunded", "canceled"
] as const;
export type CostLineItemStatus = typeof COST_LINE_ITEM_STATUSES[number];

export interface CostLineItem {
  id: string;
  company_id: string;
  job_id: string;
  category: CostCategory;
  description: string;
  vendor_id: string | null;
  estimated_cost: number;
  quoted_to_customer: number;
  committed_amount: number;
  actual_paid: number;
  internal_cost: number;
  tax: number;
  freight: number;
  discount: number;
  returned_amount: number;
  net_cost: number;
  expected_date: string | null;
  purchase_date: string | null;
  payment_method: string;
  status: CostLineItemStatus;
  responsible_user_id: string | null;
  receipt_id: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
