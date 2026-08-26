import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { saveIntegrationSettings } from "../data/integrationSettings";
import { useIntegrationSettings } from "../data/hooks";
import { now } from "../domain/format";
import type { IntegrationSettings } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { clearGoogleSession, connectGoogleWorkspace, isGoogleSessionConnected, mergeScopes, startGoogleCalendarAuth } from "../lib/googleOAuth";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

// Ported verbatim from app.js (renderIntegrations, oauthCard, integrationCard,
// saveIntegrationSetting, toggleIntegration, saveCompanyIntegrationValue,
// loadGoogleOAuthJson, saveOAuthField, connectGoogleWorkspace, clearGoogleSession).
export default function Integrations() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { session } = useAuth();
  const { data: settings } = useIntegrationSettings();
  const queryClient = useQueryClient();
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Lands here after web/api/google-oauth-callback.js redirects back from
  // Google with either ?connected=calendar or ?calendar_error=... — this is
  // the completion of startCalendarOAuth()'s redirect chain, not something
  // that can be handled inline like the popup-based connects below.
  //
  // startCalendarOAuth() now sends the user through this whole chain in a
  // separate popup tab (see below) instead of navigating the CRM tab itself
  // away to Google. That means *this* landing also happens inside that
  // popup — so when window.opener is set, hand the result back to the CRM
  // tab via postMessage and close instead of rendering a second full copy
  // of the app. If the popup got blocked and startCalendarOAuth() fell back
  // to a same-tab redirect, window.opener is null here and this tab handles
  // it directly, same as before.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const calendarError = searchParams.get("calendar_error");
    if (!connected && !calendarError) return;

    (async () => {
      if (connected === "calendar") {
        await patch(s => ({ ...s, google_calendar: { ...s.google_calendar, enabled: true } }));
      }
      if (window.opener) {
        try {
          window.opener.postMessage(
            { source: "fialho-google-oauth", connected: connected === "calendar", error: calendarError || null },
            window.location.origin
          );
        } catch { /* opener gone or cross-origin — nothing to notify */ }
        window.close();
        return;
      }
      if (connected === "calendar") toast("Google Calendar connected — background sync will pick up scheduled jobs.");
      else if (calendarError) toast(`Google Calendar connection failed: ${calendarError}`);
      searchParams.delete("connected");
      searchParams.delete("calendar_error");
      setSearchParams(searchParams, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Companion to the popup landing above: when *this* (original) tab
  // receives the postMessage from that popup, refresh the settings this tab
  // already has cached and surface the same toast the old same-tab redirect
  // used to show directly.
  useEffect(() => {
    function onOAuthMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.data?.source !== "fialho-google-oauth") return;
      if (e.data.connected) {
        queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
        toast("Google Calendar connected — background sync will pick up scheduled jobs.");
      } else if (e.data.error) {
        toast(`Google Calendar connection failed: ${e.data.error}`);
      }
    }
    window.addEventListener("message", onOAuthMessage);
    return () => window.removeEventListener("message", onOAuthMessage);
  }, [queryClient]);

  if (!settings || !activeCompanyId) return null;
  const activeSettings = settings;
  const companyId = activeCompanyId;

  async function startCalendarOAuth() {
    if (!activeSettings.google_oauth.client_id) { toast("Import the Google OAuth JSON first."); return; }
    if (!session?.access_token) { toast("Your session expired — sign in again."); return; }
    // Opened synchronously, before the await below, so it's still tied to
    // this click — most browsers block a window.open() that happens after
    // an await, treating it as an unsolicited popup rather than a
    // user-initiated one. Its location is filled in once the signed URL
    // comes back, so the CRM tab itself never navigates away to Google.
    const popup = window.open("", "_blank");
    try {
      const url = await startGoogleCalendarAuth(session.access_token, companyId);
      if (popup) popup.location.href = url;
      else location.href = url; // popup blocked — fall back to the old same-tab redirect
    } catch (err) {
      popup?.close();
      toast(errorMessage(err, "Could not start the Google connection."));
    }
  }

  async function patch(updater: (s: IntegrationSettings) => IntegrationSettings) {
    const next = updater(activeSettings);
    await saveIntegrationSettings(next);
    queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
  }

  function toggleIntegration(key: keyof IntegrationSettings) {
    patch(s => ({ ...s, [key]: { ...(s[key] as any), enabled: !(s[key] as any).enabled } }));
  }

  function saveIntegrationSetting(key: keyof IntegrationSettings, value: string) {
    patch(s => key === "google_maps"
      ? { ...s, google_maps: { ...s.google_maps, api_key: value } }
      : { ...s, [key]: { ...(s[key] as any), notes: value } });
    toast("Integration setting saved.");
  }

  function savePickerApiKey(value: string) {
    patch(s => ({ ...s, google_drive: { ...s.google_drive, picker_api_key: value } }));
    toast("Drive Picker API key saved.");
  }

  function saveEmailSmsField(field: "from_email" | "from_phone", value: string) {
    patch(s => ({ ...s, email_sms: { ...s.email_sms, [field]: value } }));
    toast("Email/SMS setting saved.");
  }

  function saveMetaAdAccountId(value: string) {
    patch(s => ({ ...s, meta_ads: { ...s.meta_ads, ad_account_ids: { ...s.meta_ads.ad_account_ids, [companyId]: value } } }));
    toast("Meta Ads account id saved.");
  }

  function saveCompanyIntegrationValue(key: "google_sheets" | "google_drive" | "google_calendar", field: string, value: string) {
    patch(s => ({ ...s, [key]: { ...(s[key] as any), [field]: { ...((s[key] as any)[field] || {}), [companyId]: value } } }));
    toast("Company integration setting saved.");
  }

  function saveOAuthField(field: string, value: string) {
    patch(s => ({ ...s, google_oauth: { ...s.google_oauth, [field]: value, enabled: field === "client_id" ? Boolean(value) : Boolean(s.google_oauth.client_id) } }));
    toast("Google OAuth setting saved.");
  }

  function loadGoogleOAuthJson(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const parsed = JSON.parse(String(event.target?.result));
        const config = parsed.web || parsed.installed || parsed;
        if (!config.client_id) throw new Error("Missing client_id");
        patch(s => ({
          ...s,
          google_oauth: {
            ...s.google_oauth,
            client_id: config.client_id,
            project_id: config.project_id || s.google_oauth.project_id || "",
            javascript_origins: config.javascript_origins || [],
            enabled: true,
            connected_at: ""
          }
        }));
        toast("Google OAuth config imported. Client secret was ignored.");
      } catch {
        toast("Could not read that OAuth JSON.");
      }
    };
    reader.readAsText(file);
  }

  async function handleConnect(service: "basic" | "calendar" | "drive" | "sheets") {
    if (!activeSettings.google_oauth.client_id) { toast("Import the Google OAuth JSON first."); return; }
    setConnectingService(service);
    try {
      const { grantedScope } = await connectGoogleWorkspace(activeSettings.google_oauth.client_id, service);
      await patch(s => ({
        ...s,
        google_oauth: { ...s.google_oauth, enabled: true, connected_at: now(), granted_scopes: mergeScopes(s.google_oauth.granted_scopes, grantedScope) },
        ...(service === "calendar" ? { google_calendar: { ...s.google_calendar, enabled: true } } : {}),
        ...(service === "drive" ? { google_drive: { ...s.google_drive, enabled: true } } : {}),
        ...(service === "sheets" ? { google_sheets: { ...s.google_sheets, enabled: true } } : {})
      }));
      toast(`Google ${service} connected for this browser session.`);
    } catch {
      toast("Google connection was not completed.");
    } finally {
      setConnectingService(null);
    }
  }

  function handleClearSession() {
    clearGoogleSession();
    toast("Google session disconnected.");
  }

  const connectedLabel = isGoogleSessionConnected() ? "connected this session" : settings.google_oauth.enabled ? "configured" : "not configured";

  return (
    <>
      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-h"><h3>Google OAuth</h3><span className="pill">{connectedLabel}</span></div>
        <div className="card-b">
          <p className="sub">Upload the Google Web OAuth JSON. The CRM stores the Client ID and project only; it does not store the client secret.</p>
          <div className="form-row">
            <div className="field"><label>OAuth JSON from Google Cloud</label><input type="file" accept=".json,application/json" onChange={e => loadGoogleOAuthJson(e.target.files?.[0] || null)} /></div>
            <div className="field"><label>OAuth Client ID</label><input value={settings.google_oauth.client_id || ""} onChange={e => saveOAuthField("client_id", e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Project ID</label><input value={settings.google_oauth.project_id || ""} onChange={e => saveOAuthField("project_id", e.target.value)} /></div>
            <div className="field"><label>Granted scopes</label><input value={settings.google_oauth.granted_scopes || ""} readOnly /></div>
          </div>
          <div className="inline-actions">
            <button className="btn ghost slim" onClick={() => handleConnect("basic")} disabled={connectingService !== null}>Connect basic</button>
            <button className="btn ghost slim" onClick={() => handleConnect("calendar")} disabled={connectingService !== null}>Allow Calendar</button>
            <button className="btn ghost slim" onClick={() => handleConnect("drive")} disabled={connectingService !== null}>Allow Drive</button>
            <button className="btn ghost slim" onClick={() => handleConnect("sheets")} disabled={connectingService !== null}>Allow Sheets</button>
            <button className="btn ghost slim" onClick={handleClearSession}>Disconnect session</button>
          </div>
          <p className="sub">Authorized origin needed in Google Cloud: {location.origin}</p>
          <p className="sub"><b>Access blocked?</b> In production, Google blocks OAuth if the request includes sensitive scopes that are not listed or approved in Google Auth platform &gt; Data Access.</p>
        </div>
      </section>

      <div className="grid three">
        <IntegrationCard
          k="google_maps" title="Map & Geocoding" description="Powers the Company map, address geocoding, and route optimization/directions on Map & Routes."
          setting={settings.google_maps} onSaveSetting={saveIntegrationSetting} onToggle={toggleIntegration}
          extra={
            <p className="sub">
              Needs Maps JavaScript API, Geocoding API, and Directions API enabled (with billing) on an
              HTTP-referrer-restricted key in Google Cloud Console.
            </p>
          }
        />
        <IntegrationCard
          k="google_calendar" title="Google Calendar" description="Scheduled jobs sync automatically to this company's Google Calendar, no need to keep the CRM open."
          setting={settings.google_calendar} onSaveSetting={saveIntegrationSetting} onToggle={toggleIntegration}
          extra={
            <>
              <div className="field">
                <label>Company Google Calendar ID</label>
                <input value={settings.google_calendar.calendar_ids?.[companyId] || ""} onChange={e => saveCompanyIntegrationValue("google_calendar", "calendar_ids", e.target.value)} placeholder="primary" />
                <p className="sub">Leave blank to use the connected account's primary calendar.</p>
              </div>
              <button className="btn ghost slim" onClick={startCalendarOAuth}>Connect for background sync</button>
            </>
          }
        />
        <IntegrationCard
          k="google_sheets" title="Google Sheets" description="Used for future direct sheet imports and exports."
          setting={settings.google_sheets} onSaveSetting={saveIntegrationSetting} onToggle={toggleIntegration}
          extra={
            <div className="field">
              <label>Default Google Sheet URL for {activeCompany?.name}</label>
              <input value={settings.google_sheets.source_urls?.[companyId] || ""} onChange={e => saveCompanyIntegrationValue("google_sheets", "source_urls", e.target.value)} />
            </div>
          }
        />
        <IntegrationCard
          k="google_drive" title="Google Drive" description="Used for client/job folders, files, and project documents."
          setting={settings.google_drive} onSaveSetting={saveIntegrationSetting} onToggle={toggleIntegration}
          extra={
            <>
              <div className="field">
                <label>Company Google Drive root folder URL</label>
                <input value={settings.google_drive.folder_urls?.[companyId] || ""} onChange={e => saveCompanyIntegrationValue("google_drive", "folder_urls", e.target.value)} />
              </div>
              {settings.google_drive.folder_urls?.[companyId] && (
                <a className="btn ghost slim" target="_blank" rel="noreferrer" href={settings.google_drive.folder_urls[companyId]}>Open Drive folder</a>
              )}
              <div className="field">
                <label>Google Picker API key</label>
                <input value={settings.google_drive.picker_api_key || ""} onChange={e => savePickerApiKey(e.target.value)} placeholder="Enables the 'Attach from Drive' file picker" />
                <p className="sub">Enable the Google Picker API on the same Cloud project as your OAuth client, then paste its API key here.</p>
              </div>
            </>
          }
        />
        <section className="card">
          <div className="card-h"><h3>Email &amp; SMS</h3><span className="pill">{settings.email_sms.enabled ? "enabled" : "planned"}</span></div>
          <div className="card-b">
            <p className="sub">Sends a reminder (SMS if the client has a phone on file, else email) the day before a scheduled job, plus a manual "Send reminder now" button on jobs.</p>
            <div className="field"><label>From email (Resend)</label><input value={settings.email_sms.from_email} onChange={e => saveEmailSmsField("from_email", e.target.value)} placeholder="notifications@yourdomain.com" /></div>
            <div className="field"><label>From phone (Twilio)</label><input value={settings.email_sms.from_phone} onChange={e => saveEmailSmsField("from_phone", e.target.value)} placeholder="+15555550123" /></div>
            <p className="sub">Real API keys (Resend, Twilio) are set as Vercel/GitHub Actions secrets, not here — ask Victor if those aren't set up yet.</p>
            <button className="btn ghost slim" onClick={() => toggleIntegration("email_sms")}>{settings.email_sms.enabled ? "Mark planned" : "Mark ready"}</button>
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h3>Meta Ads</h3><span className="pill">{settings.meta_ads.enabled ? "enabled" : "planned"}</span></div>
          <div className="card-b">
            <p className="sub">Daily ad spend/impressions/clicks sync from Meta Ads Manager into Reports.</p>
            <div className="field">
              <label>Ad account ID for {activeCompany?.name}</label>
              <input value={settings.meta_ads.ad_account_ids?.[companyId] || ""} onChange={e => saveMetaAdAccountId(e.target.value)} placeholder="act_1234567890" />
            </div>
            <p className="sub">The Marketing API access token is a GitHub Actions secret, set up by Victor separately.</p>
            <button className="btn ghost slim" onClick={() => toggleIntegration("meta_ads")}>{settings.meta_ads.enabled ? "Mark planned" : "Mark ready"}</button>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Connection status</h3><span className="sub">Local CRM with optional Google OAuth</span></div>
        <div className="card-b">
          <p><b>Maps:</b> {settings.google_maps.enabled ? "Google Maps API key configured." : "Add a Google Maps API key above to enable the map, geocoding, and route optimization."}</p>
          <p><b>Calendar:</b> ICS import/export plus background OAuth sync to Google Calendar are active.</p>
          <p><b>Drive:</b> folder URL fields are active; "Attach from Drive" opens a real file picker once a Picker API key is set above.</p>
          <p><b>Sheets:</b> public/published CSV import is active; "Connect Google & load private sheet" (Import Center) reads private sheets directly via OAuth.</p>
          <p><b>Email/SMS:</b> {settings.email_sms.enabled ? "Enabled — reminders send via Resend/Twilio once their API keys are set as server secrets." : "Not enabled yet."}</p>
          <p><b>Meta Ads:</b> {settings.meta_ads.enabled ? "Enabled — daily ad performance sync runs once the Marketing API token secret is set." : "Not enabled yet."}</p>
        </div>
      </section>
    </>
  );
}

function IntegrationCard({ k, title, description, setting, onSaveSetting, onToggle, extra }: {
  k: keyof IntegrationSettings;
  title: string;
  description: string;
  setting: { enabled: boolean; api_key?: string; notes: string };
  onSaveSetting: (key: keyof IntegrationSettings, value: string) => void;
  onToggle: (key: keyof IntegrationSettings) => void;
  extra?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-h"><h3>{title}</h3><span className="pill">{setting.enabled ? "enabled" : "planned"}</span></div>
      <div className="card-b">
        <p className="sub">{description}</p>
        <div className="field">
          <label>API key / OAuth note</label>
          <input value={setting.api_key || setting.notes || ""} onChange={e => onSaveSetting(k, e.target.value)} />
        </div>
        {extra}
        <button className="btn ghost slim" onClick={() => onToggle(k)}>{setting.enabled ? "Mark planned" : "Mark ready"}</button>
      </div>
    </section>
  );
}
