// Ported verbatim from app.js (loadGoogleIdentity, connectGoogleWorkspace's script/
// token-client wiring, mergeScopes, googleAccessToken, clearGoogleSession). Same
// sessionStorage key names, same scope presets, same per-browser-session model —
// full two-way OAuth sync is still a later-sprint feature in the original app too.
declare global {
  interface Window { google?: any }
}

export const GOOGLE_SCOPE_PRESETS: Record<string, string> = {
  basic: "openid email profile",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.file",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly"
};

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-google-identity]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google sign-in.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(script);
  });
}

export function mergeScopes(existing: string, next: string): string {
  return Array.from(new Set(`${existing || ""} ${next || ""}`.split(/\s+/).filter(Boolean))).join(" ");
}

export function googleAccessToken(): string {
  return sessionStorage.getItem("fialho_google_access_token_basic") || "";
}

// Per-service token lookup — googleAccessToken() above only ever reads the
// "basic" slot, but connectGoogleWorkspace() stores a separate token per
// service (drive/sheets/calendar), so callers that need the Sheets or Drive
// token specifically (googleSheetsApi.ts, googleDrivePicker.ts) need this.
export function googleAccessTokenFor(service: "basic" | "calendar" | "drive" | "sheets"): string {
  return sessionStorage.getItem(`fialho_google_access_token_${service}`) || "";
}

export function isGoogleSessionConnected(): boolean {
  return ["basic", "calendar", "drive", "sheets"].some(service => sessionStorage.getItem(`fialho_google_access_token_${service}`));
}

export function clearGoogleSession() {
  ["basic", "calendar", "drive", "sheets"].forEach(service => sessionStorage.removeItem(`fialho_google_access_token_${service}`));
}

// Full-page redirect flow (as opposed to connectGoogleWorkspace's popup
// token client below) — the only way to get a refresh_token back, which is
// what web/api/google-oauth-callback.js needs to set up background sync.
//
// SECURITY (2026-08-26 fix): this used to build the Google authorize URL
// entirely client-side with `state` set to the plain, unsigned company_id —
// which let anyone craft their own `state=<victim_company_id>` and hijack
// another company's Calendar connection (see web/api/google-oauth-callback.js's
// comment). URL construction now happens server-side in
// web/api/google-oauth-start.js, which verifies the caller's session and
// company membership before minting an HMAC-signed `state` the callback can
// trust. Call that endpoint (with the current Supabase session's access
// token) instead of building the URL here.
export async function startGoogleCalendarAuth(accessToken: string, companyId: string): Promise<string> {
  const res = await fetch("/api/google-oauth-start", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ company_id: companyId })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Could not start the Google connection.");
  return body.url;
}

export async function connectGoogleWorkspace(
  clientId: string,
  service: "basic" | "calendar" | "drive" | "sheets"
): Promise<{ accessToken: string; grantedScope: string }> {
  await loadGoogleIdentity();
  const scope = GOOGLE_SCOPE_PRESETS[service] || GOOGLE_SCOPE_PRESETS.basic;
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response: any) => {
        if (response.error) { reject(new Error("Google connection was not completed.")); return; }
        sessionStorage.setItem(`fialho_google_access_token_${service}`, response.access_token);
        resolve({ accessToken: response.access_token, grantedScope: response.scope || scope });
      }
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}
