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

export function isGoogleSessionConnected(): boolean {
  return ["basic", "calendar", "drive", "sheets"].some(service => sessionStorage.getItem(`fialho_google_access_token_${service}`));
}

export function clearGoogleSession() {
  ["basic", "calendar", "drive", "sheets"].forEach(service => sessionStorage.removeItem(`fialho_google_access_token_${service}`));
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
