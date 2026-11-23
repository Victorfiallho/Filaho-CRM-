// Turns what we can actually observe about each integration into the
// Integrations screen's badge and one-line explanation. The "enabled"
// switches only record that someone flipped them; these read the facts
// (get_integration_health, the messaging status from the server, and the
// live Google Maps check in lib/mapsCheck.ts). Pure, so every case is tested.

export type HealthState = "ok" | "warn" | "error" | "off";

// A message key plus its values, so the screen translates it.
export interface Health {
  state: HealthState;
  key: string;
  vars?: Record<string, string | number>;
}

export interface IntegrationFacts {
  google: { connected: boolean; account_email: string; calendar: boolean; drive: boolean; sheets: boolean; gmail: boolean };
  calendar: { scheduled: number; synced: number };
  drive: { jobs: number; with_folder: number };
  maps: { clients: number; geocoded: number };
  meta: { last_sync: string | null; rows: number };
}

// What the live Maps check found (lib/mapsCheck.ts).
export interface MapsCheck {
  map: { ok: boolean; code?: string };          // Maps JavaScript API (the map itself)
  geocode: { ok: boolean; status?: string; message?: string }; // Geocoding API (coordinates)
}

const h = (state: HealthState, key: string, vars?: Health["vars"]): Health => ({ state, key, vars });

export function mapsHealth(hasKey: boolean, check: MapsCheck | null, facts: IntegrationFacts | null): Health {
  if (!hasKey) return h("off", "health.maps.noKey");
  if (!check) return h("off", "health.checking");
  if (!check.map.ok) return h("error", `health.maps.map.${MAP_ERRORS.has(check.map.code || "") ? check.map.code : "unknown"}`, { code: check.map.code || "?" });
  if (!check.geocode.ok) return h("error", "health.maps.geocode", { status: check.geocode.status || "?", message: check.geocode.message || "" });
  if (facts && facts.maps.clients > 0 && facts.maps.geocoded < facts.maps.clients) {
    return h("warn", "health.maps.missing", { missing: facts.maps.clients - facts.maps.geocoded, total: facts.maps.clients });
  }
  return h("ok", "health.maps.ok");
}

// The Google Maps JavaScript API errors we explain in plain words; others
// show their code.
export const MAP_ERRORS = new Set([
  "RefererNotAllowedMapError", "ApiNotActivatedMapError", "BillingNotEnabledMapError",
  "InvalidKeyMapError", "ApiTargetBlockedMapError", "ExpiredKeyMapError", "MissingKeyMapError"
]);

function googleBase(facts: IntegrationFacts, scope: "calendar" | "drive" | "sheets" | "gmail"): Health | null {
  if (!facts.google.connected) return h("off", "health.google.notConnected");
  if (!facts.google[scope]) return h("error", `health.google.noScope.${scope}`);
  return null;
}

export function calendarHealth(facts: IntegrationFacts | null): Health {
  if (!facts) return h("off", "health.checking");
  const base = googleBase(facts, "calendar");
  if (base) return base;
  const { scheduled, synced } = facts.calendar;
  if (scheduled === 0) return h("ok", "health.calendar.nothingYet");
  if (synced < scheduled) return h("warn", "health.calendar.partial", { synced, scheduled });
  return h("ok", "health.calendar.ok", { synced });
}

export function driveHealth(facts: IntegrationFacts | null): Health {
  if (!facts) return h("off", "health.checking");
  const base = googleBase(facts, "drive");
  if (base) return base;
  if (facts.drive.jobs > 0 && facts.drive.with_folder === 0) return h("warn", "health.drive.noFolders", { jobs: facts.drive.jobs });
  return h("ok", "health.drive.ok", { folders: facts.drive.with_folder });
}

export function sheetsHealth(facts: IntegrationFacts | null): Health {
  if (!facts) return h("off", "health.checking");
  return googleBase(facts, "sheets") ?? h("ok", "health.sheets.ok");
}

export function messagingHealth(status: { sms: boolean; email: boolean; email_via: string | null } | null | undefined): Health {
  if (!status) return h("off", "health.checking");
  if (status.email && status.sms) return h("ok", "health.messaging.both", { via: status.email_via === "gmail" ? "Gmail" : "Resend" });
  if (status.email) return h("warn", "health.messaging.emailOnly", { via: status.email_via === "gmail" ? "Gmail" : "Resend" });
  if (status.sms) return h("warn", "health.messaging.smsOnly");
  return h("off", "health.messaging.none");
}

export function metaHealth(enabled: boolean, hasAccount: boolean, facts: IntegrationFacts | null, now = new Date()): Health {
  if (!enabled || !hasAccount) return h("off", "health.meta.notSetUp");
  if (!facts) return h("off", "health.checking");
  if (!facts.meta.last_sync) return h("error", "health.meta.never");
  const days = Math.floor((now.getTime() - Date.parse(facts.meta.last_sync)) / 86400000);
  if (days > 2) return h("warn", "health.meta.stale", { days });
  return h("ok", "health.meta.ok", { rows: facts.meta.rows });
}
