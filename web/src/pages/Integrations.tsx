import PageSkeleton from "../components/PageSkeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getIntegrationSettings, saveIntegrationSettings } from "../data/integrationSettings";
import { useIntegrationSettings, useMessagingStatus } from "../data/hooks";
import { now } from "../domain/format";
import type { IntegrationSettings } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { clearGoogleSession, connectGoogleWorkspace, isGoogleSessionConnected, mergeScopes, startGoogleCalendarAuth } from "../lib/googleOAuth";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import FileButton from "../components/FileButton";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";

// Integrations: Google OAuth client, Calendar/Drive/Sheets, Maps, Meta Ads,
// email and SMS.
export default function Integrations() {
  const { activeCompanyId, activeCompany } = useCompany();
  const { session } = useAuth();
  const { t } = useT();
  const { data: settings } = useIntegrationSettings();
  const { data: messaging } = useMessagingStatus(activeCompanyId);
  const queryClient = useQueryClient();
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Google sends the browser back here with ?connected=calendar or
  // ?calendar_error=... The connect runs in a popup tab, so when there's a
  // window.opener, hand the result to the CRM tab and close. If the popup was
  // blocked, the same tab redirected and handles it here.
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
        } catch { /* opener gone: nothing to notify */ }
        window.close();
        return;
      }
      if (connected === "calendar") {
        toast(t("int.calConnected"));
        queryClient.invalidateQueries({ queryKey: ["messaging_status"] });
      } else if (calendarError) toastError(t("int.calFailed", { error: calendarError }));
      searchParams.delete("connected");
      searchParams.delete("calendar_error");
      setSearchParams(searchParams, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // The other half: the CRM tab gets the popup's message, refreshes the
  // settings and shows the result.
  useEffect(() => {
    function onOAuthMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.data?.source !== "fialho-google-oauth") return;
      if (e.data.connected) {
        queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
        queryClient.invalidateQueries({ queryKey: ["messaging_status"] });
        toast(t("int.calConnected"));
      } else if (e.data.error) {
        toastError(t("int.calFailed", { error: String(e.data.error) }));
      }
    }
    window.addEventListener("message", onOAuthMessage);
    return () => window.removeEventListener("message", onOAuthMessage);
  }, [queryClient]);

  if (!settings || !activeCompanyId) return <PageSkeleton cards={2} rows={[6, 6]} />;
  const activeSettings = settings;
  const companyId = activeCompanyId;

  async function startCalendarOAuth() {
    if (!activeSettings.google_oauth.client_id) { toast(t("int.importFirst")); return; }
    if (!session?.access_token) { toast(t("int.sessionExpired")); return; }
    // Opened before the await so it still counts as part of the click (browsers
    // block window.open after an await). Its URL is set once the signed URL
    // arrives, so the CRM tab never leaves.
    const popup = window.open("", "_blank");
    try {
      const url = await startGoogleCalendarAuth(session.access_token, companyId);
      if (popup) popup.location.href = url;
      else location.href = url; // popup blocked: redirect this tab instead
    } catch (err) {
      popup?.close();
      toastError(errorMessage(err, t("int.calendarError")));
    }
  }

  async function patch(updater: (s: IntegrationSettings) => IntegrationSettings) {
    // Reads the settings from the query cache (or fetches them), not from the
    // render's `activeSettings`, which doesn't exist yet when the OAuth landing
    // effect runs on the first render.
    const current = queryClient.getQueryData<IntegrationSettings>(["integration_settings"]) ?? await getIntegrationSettings();
    const next = updater(current);
    await saveIntegrationSettings(next);
    queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
  }

  // Field edits and toggles: the error reaches the user instead of a "Saved"
  // toast over a write the database refused.
  async function save(updater: (s: IntegrationSettings) => IntegrationSettings, { quiet = false } = {}) {
    try {
      await patch(updater);
      if (!quiet) toast(t("int.saved"));
    } catch (err) {
      toastError(errorMessage(err, t("int.saveFailed")));
    }
  }

  function toggleIntegration(key: keyof IntegrationSettings) {
    save(s => ({ ...s, [key]: { ...(s[key] as any), enabled: !(s[key] as any).enabled } }), { quiet: true });
  }

  function saveIntegrationSetting(key: keyof IntegrationSettings, value: string) {
    save(s => key === "google_maps"
      ? { ...s, google_maps: { ...s.google_maps, api_key: value } }
      : { ...s, [key]: { ...(s[key] as any), notes: value } });
  }

  function savePickerApiKey(value: string) {
    save(s => ({ ...s, google_drive: { ...s.google_drive, picker_api_key: value } }));
  }

  function saveEmailSmsField(field: "from_email" | "from_phone", value: string) {
    save(s => ({ ...s, email_sms: { ...s.email_sms, [field]: value } }));
  }

  function saveMetaAdAccountId(value: string) {
    save(s => ({ ...s, meta_ads: { ...s.meta_ads, ad_account_ids: { ...s.meta_ads.ad_account_ids, [companyId]: value } } }));
  }

  function saveCompanyIntegrationValue(key: "google_sheets" | "google_drive" | "google_calendar", field: string, value: string) {
    save(s => ({ ...s, [key]: { ...(s[key] as any), [field]: { ...((s[key] as any)[field] || {}), [companyId]: value } } }));
  }

  function saveOAuthField(field: string, value: string) {
    save(s => ({ ...s, google_oauth: { ...s.google_oauth, [field]: value, enabled: field === "client_id" ? Boolean(value) : Boolean(s.google_oauth.client_id) } }));
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
        toast(t("int.oauthImported"));
      } catch {
        toastError(t("int.oauthBad"));
      }
    };
    reader.readAsText(file);
  }

  async function handleConnect(service: "basic" | "calendar" | "drive" | "sheets") {
    if (!activeSettings.google_oauth.client_id) { toast(t("int.importFirst")); return; }
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
      toast(t("int.connected", { service }));
    } catch {
      toast(t("int.notCompleted"));
    } finally {
      setConnectingService(null);
    }
  }

  function handleClearSession() {
    clearGoogleSession();
    toast(t("int.disconnected"));
  }

  const sessionConnected = isGoogleSessionConnected();
  const oauthState = sessionConnected ? "session" : settings.google_oauth.enabled ? "configured" : "notConfigured";

  return (
    <>
      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-h">
          <h3>{t("int.oauth")}</h3>
          <span className={`badge-tone tone-${oauthState === "notConfigured" ? "slate" : "green"}`}>{t(`int.status.${oauthState}` as MessageKey)}</span>
        </div>
        <div className="card-b">
          <p className="sub">{t("int.oauthText")}</p>
          <div className="form-row">
            <div className="field"><label>{t("int.oauthJson")}</label><FileButton accept=".json,application/json" onFiles={files => loadGoogleOAuthJson(files?.[0] || null)} /></div>
            <div className="field"><label htmlFor="int-client-id">{t("int.clientId")}</label><DebouncedField id="int-client-id" value={settings.google_oauth.client_id || ""} onCommit={v => saveOAuthField("client_id", v)} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label htmlFor="int-project">{t("int.projectId")}</label><DebouncedField id="int-project" value={settings.google_oauth.project_id || ""} onCommit={v => saveOAuthField("project_id", v)} /></div>
            <div className="field"><label htmlFor="int-scopes">{t("int.scopes")}</label><input id="int-scopes" value={settings.google_oauth.granted_scopes || ""} readOnly /></div>
          </div>
          <div className="inline-actions" style={{ marginTop: 14 }}>
            <button className="btn slim" onClick={() => handleConnect("basic")} disabled={connectingService !== null}>{t("int.connectBasic")}</button>
            <button className="btn ghost slim" onClick={() => handleConnect("calendar")} disabled={connectingService !== null}>{t("int.allowCalendar")}</button>
            <button className="btn ghost slim" onClick={() => handleConnect("drive")} disabled={connectingService !== null}>{t("int.allowDrive")}</button>
            <button className="btn ghost slim" onClick={() => handleConnect("sheets")} disabled={connectingService !== null}>{t("int.allowSheets")}</button>
            {sessionConnected && <button className="btn ghost slim" onClick={handleClearSession}>{t("int.disconnect")}</button>}
          </div>
          <details className="help-details">
            <summary>{t("int.blocked").split("?")[0]}?</summary>
            <p className="sub">{t("int.origin", { origin: location.origin })}</p>
            <p className="sub">{t("int.blocked")}</p>
          </details>
        </div>
      </section>

      <div className="integration-grid">
        <IntegrationCard title={t("int.maps")} description={t("int.mapsText")} enabled={settings.google_maps.enabled} onToggle={() => toggleIntegration("google_maps")}>
          <div className="field">
            <label htmlFor="int-maps-key">{t("int.mapsKey")}</label>
            <SecretField id="int-maps-key" value={settings.google_maps.api_key || ""} onCommit={v => saveIntegrationSetting("google_maps", v)} />
            <p className="sub">{t("int.mapsHelp")}</p>
          </div>
        </IntegrationCard>

        <IntegrationCard title={t("int.calendar")} description={t("int.calendarText")} enabled={settings.google_calendar.enabled} onToggle={() => toggleIntegration("google_calendar")}>
          <div className="field">
            <label htmlFor="int-cal-id">{t("int.calendarId")}</label>
            <DebouncedField id="int-cal-id" value={settings.google_calendar.calendar_ids?.[companyId] || ""} onCommit={v => saveCompanyIntegrationValue("google_calendar", "calendar_ids", v)} placeholder="primary" />
            <p className="sub">{t("int.calendarIdHelp")}</p>
          </div>
          <button className="btn ghost slim" onClick={startCalendarOAuth}>{t("int.calendarConnect")}</button>
        </IntegrationCard>

        <IntegrationCard title={t("int.sheets")} description={t("int.sheetsText")} enabled={settings.google_sheets.enabled} onToggle={() => toggleIntegration("google_sheets")}>
          <div className="field">
            <label htmlFor="int-sheet">{t("int.sheetUrl", { company: activeCompany?.name || "" })}</label>
            <DebouncedField id="int-sheet" value={settings.google_sheets.source_urls?.[companyId] || ""} onCommit={v => saveCompanyIntegrationValue("google_sheets", "source_urls", v)} />
          </div>
        </IntegrationCard>

        <IntegrationCard title={t("int.drive")} description={t("int.driveText")} enabled={settings.google_drive.enabled} onToggle={() => toggleIntegration("google_drive")}>
          <div className="field">
            <label htmlFor="int-drive">{t("int.driveRoot")}</label>
            <DebouncedField id="int-drive" value={settings.google_drive.folder_urls?.[companyId] || ""} onCommit={v => saveCompanyIntegrationValue("google_drive", "folder_urls", v)} />
          </div>
          {settings.google_drive.folder_urls?.[companyId] && (
            <a className="action-pill" target="_blank" rel="noreferrer" href={settings.google_drive.folder_urls[companyId]}>{t("int.openDrive")}</a>
          )}
          <div className="field">
            <label htmlFor="int-picker">{t("int.pickerKey")}</label>
            <SecretField id="int-picker" value={settings.google_drive.picker_api_key || ""} onCommit={savePickerApiKey} />
            <p className="sub">{t("int.pickerHelp")}</p>
          </div>
        </IntegrationCard>

        <IntegrationCard title={t("int.emailSms")} description={t("int.emailSmsText")} enabled={settings.email_sms.enabled} onToggle={() => toggleIntegration("email_sms")}>
          <div className="field">
            <label>{t("int.gmail")}</label>
            <p className="sub">{messaging?.email_via === "gmail" ? t("int.gmailOn", { account: messaging.email_account || "Gmail" }) : t("int.gmailOff")}</p>
            <button className="btn ghost slim" type="button" onClick={startCalendarOAuth}>{messaging?.email_via === "gmail" ? t("int.gmailReconnect") : t("int.gmailConnect")}</button>
          </div>
          <div className="field"><label htmlFor="int-from-email">{t("int.fromEmail")}</label><DebouncedField id="int-from-email" value={settings.email_sms.from_email} onCommit={v => saveEmailSmsField("from_email", v)} placeholder="notifications@yourdomain.com" /></div>
          <div className="field"><label htmlFor="int-from-phone">{t("int.fromPhone")}</label><DebouncedField id="int-from-phone" value={settings.email_sms.from_phone} onCommit={v => saveEmailSmsField("from_phone", v)} placeholder="+15555550123" /></div>
          <p className="sub">{t("int.serverKeys")}</p>
        </IntegrationCard>

        <IntegrationCard title={t("int.meta")} description={t("int.metaText")} enabled={settings.meta_ads.enabled} onToggle={() => toggleIntegration("meta_ads")}>
          <div className="field">
            <label htmlFor="int-meta">{t("int.adAccount", { company: activeCompany?.name || "" })}</label>
            <DebouncedField id="int-meta" value={settings.meta_ads.ad_account_ids?.[companyId] || ""} onCommit={saveMetaAdAccountId} placeholder="act_1234567890" />
          </div>
          <p className="sub">{t("int.serverKeys")}</p>
        </IntegrationCard>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card-h"><h3>{t("int.overview")}</h3></div>
        <div className="card-b">
          <ul className="status-list">
            <li className={`tone-${settings.google_maps.enabled ? "green" : "slate"}`}>{t("int.ov.maps", { state: settings.google_maps.enabled ? t("int.ov.mapsOn") : t("int.ov.mapsOff") })}</li>
            <li className="tone-green">{t("int.ov.calendar")}</li>
            <li className="tone-green">{t("int.ov.drive")}</li>
            <li className="tone-green">{t("int.ov.sheets")}</li>
            <li className={`tone-${settings.email_sms.enabled ? "green" : "slate"}`}>{t("int.ov.email", { state: settings.email_sms.enabled ? t("int.ov.on") : t("int.ov.off") })}</li>
            <li className={`tone-${settings.meta_ads.enabled ? "green" : "slate"}`}>{t("int.ov.meta", { state: settings.meta_ads.enabled ? t("int.ov.on") : t("int.ov.off") })}</li>
          </ul>
        </div>
      </section>
    </>
  );
}

// Text fields keep a local draft while focused and save once on blur;
// saving on every keystroke raced the refetch and ate characters.
function DebouncedField({ value, onCommit, ...props }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onFocus">) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <input
      {...props}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

// API keys are masked, with Show/Hide and an "ends in …XXXX" hint to tell
// which key is saved.
function SecretField({ id, value, onCommit }: { id: string; value: string; onCommit: (v: string) => void }) {
  const { t } = useT();
  const [reveal, setReveal] = useState(false);
  return (
    <>
      <div className="input-with-icon secret-field">
        <DebouncedField id={id} value={value} onCommit={onCommit} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false} />
        <button type="button" className="input-icon-btn" onClick={() => setReveal(v => !v)} aria-label={reveal ? t("int.hide") : t("int.show")} aria-controls={id}>
          {reveal ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {value && !reveal && <span className="sub">{t("int.endsWith", { last: value.slice(-4) })}</span>}
    </>
  );
}

function IntegrationCard({ title, description, enabled, onToggle, children }: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useT();
  return (
    <section className="card integration-card">
      <div className="card-h">
        <h3>{title}</h3>
        <span className={`badge-tone tone-${enabled ? "green" : "slate"}`}>{enabled ? t("int.status.ready") : t("int.status.planned")}</span>
      </div>
      <div className="card-b">
        <p className="sub">{description}</p>
        {children}
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={enabled} onChange={onToggle} />
          <span className="switch" aria-hidden="true" />
          <span>{t("int.markReady")}</span>
        </label>
      </div>
    </section>
  );
}
