import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { saveIntegrationSettings } from "../data/integrationSettings";
import { useIntegrationSettings } from "../data/hooks";
import { now } from "../domain/format";
import type { IntegrationSettings } from "../domain/types";
import { clearGoogleSession, connectGoogleWorkspace, googleCalendarAuthUrl, isGoogleSessionConnected, mergeScopes } from "../lib/googleOAuth";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";

// Ported verbatim from app.js (renderIntegrations, oauthCard, integrationCard,
// saveIntegrationSetting, toggleIntegration, saveCompanyIntegrationValue,
// loadGoogleOAuthJson, saveOAuthField, connectGoogleWorkspace, clearGoogleSession).
export default function Integrations() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { data: settings } = useIntegrationSettings();
  const queryClient = useQueryClient();
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Lands here after web/api/google-oauth-callback.js redirects back from
  // Google with either ?connected=calendar or ?calendar_error=... — this is
  // the completion of startCalendarOAuth()'s full-page redirect, not
  // something that can be handled inline like the popup-based connects below.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const calendarError = searchParams.get("calendar_error");
    if (connected === "calendar") {
      patch(s => ({ ...s, google_calendar: { ...s.google_calendar, enabled: true } }));
      toast("Google Calendar connected — background sync will pick up scheduled jobs.");
    } else if (calendarError) {
      toast(`Google Calendar connection failed: ${calendarError}`);
    }
    if (connected || calendarError) {
      searchParams.delete("connected");
      searchParams.delete("calendar_error");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (!settings || !activeCompanyId) return null;
  const activeSettings = settings;
  const companyId = activeCompanyId;

  function startCalendarOAuth() {
    if (!activeSettings.google_oauth.client_id) { toast("Import the Google OAuth JSON first."); return; }
    location.href = googleCalendarAuthUrl(activeSettings.google_oauth.client_id, companyId);
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

      <div className="grid two">
        <section className="card">
          <div className="card-h"><h3>Map &amp; Geocoding</h3><span className="pill">OpenStreetMap</span></div>
          <div className="card-b">
            <p className="sub">
              Map & Routes now runs on OpenStreetMap (Leaflet tiles + Nominatim geocoding) — no API key needed,
              no cost, nothing to configure here. This replaces the Google Maps API this card used to control.
            </p>
          </div>
        </section>
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
            </>
          }
        />
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>Connection status</h3><span className="sub">Local CRM with optional Google OAuth</span></div>
        <div className="card-b">
          <p><b>Maps:</b> OpenStreetMap tiles and Nominatim geocoding are active by default, no setup needed.</p>
          <p><b>Calendar:</b> ICS import/export is active. OAuth enables future live Google Calendar sync.</p>
          <p><b>Drive:</b> folder URL fields are active. OAuth enables future file picker/upload workflows.</p>
          <p><b>Sheets:</b> public/published CSV import is active. OAuth enables future private Sheet reads.</p>
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
