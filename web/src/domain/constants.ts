// Ported verbatim from app.js — company icon SVGs, module nav, import field/preset
// definitions, and Google OAuth scope presets. Companies themselves, pipeline stages,
// and service lists now live in Supabase (companies / pipeline_stages / company_services)
// instead of being hardcoded here, since that's the whole point of the migration —
// these constants are the parts that were never data, just UI/config.

export const COMPANY_ICONS: Record<string, string> = {
  peach_fresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>`,
  wish_cabinets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
  peach_state_flooring: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="m12.83 2.18-8.58 3.9a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83l-8.58-3.91a2 2 0 0 0-1.66 0Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
  arca_cabinets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`
};

export const MODULES: [string, string][] = [
  ["dashboard", "Dashboard"],
  ["pipeline", "Pipeline"],
  ["customers", "Clients"],
  ["jobs", "Jobs"],
  ["calendar", "Calendar"],
  ["map", "Map & Routes"],
  ["import", "Import Center"],
  ["integrations", "Integrations"],
  ["reports", "Reports"]
];

export const IMPORT_FIELDS: [string, string][] = [
  ["name", "Name"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"],
  ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["service_type", "Service type"],
  ["status", "Status"], ["stage_id", "Pipeline stage"], ["value", "Estimated value"], ["scheduled_date", "Date"],
  ["notes", "Notes"], ["drive_folder_url", "Drive folder URL"], ["lat", "Latitude"], ["lng", "Longitude"]
];

export type ImportSourceType = "csv" | "sheets" | "calendar" | "calendar_ics" | "manual";

export const IMPORT_PRESETS: Record<ImportSourceType, { label: string; aliases: Record<string, string[]> }> = {
  csv: { label: "CSV upload", aliases: {} },
  sheets: { label: "Google Sheets CSV", aliases: {} },
  calendar: { label: "Google Calendar CSV", aliases: { name: ["summary", "subject", "title"], scheduled_date: ["start date", "date"], address: ["location", "where"] } },
  calendar_ics: { label: "Google Calendar ICS", aliases: {} },
  manual: { label: "Manual list", aliases: {} }
};

export const GOOGLE_SCOPE_PRESETS: Record<string, string> = {
  basic: "openid email profile",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.file",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly"
};
