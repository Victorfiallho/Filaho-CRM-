import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import Select from "../components/Select";
import { useCustomers, useImportsHistory, useIntegrationSettings, useInvalidateCompanyData, usePermissions } from "../data/hooks";
import { saveIntegrationSettings } from "../data/integrationSettings";
import { insertCustomer, updateCustomer } from "../data/customers";
import { insertImport } from "../data/imports";
import { insertJob, updateJob } from "../data/jobs";
import { insertLead } from "../data/leads";
import { listJobs } from "../data/jobs";
import { listServices } from "../data/services";
import { parseCSV } from "../domain/csv";
import { IMPORT_FIELDS, IMPORT_PRESETS, type ImportSourceType } from "../domain/constants";
import { findDuplicate, findDuplicateJob, type DuplicateMatch } from "../domain/dedupe";
import { now, uid } from "../domain/format";
import { extractSpreadsheetId, toGoogleSheetCsvUrl } from "../domain/googleSheets";
import { fetchPrivateSheetValues } from "../data/googleSheetsApi";
import {
  classifyCalendarEvent, extractFirstIcsFromZip, jobFromIcsEvent, parseICS
} from "../domain/ics";
import { autoMapHeaders, mappedRecord } from "../domain/importMapping";
import { cleanCustomer, cleanJob, leadFromCustomer } from "../domain/records";
import type { Customer, Job } from "../domain/types";
import { errorMessage } from "../lib/errorMessage";
import { connectGoogleWorkspace, googleAccessTokenFor } from "../lib/googleOAuth";
import { toast, toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import FileButton from "../components/FileButton";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import { useT } from "../i18n/I18nContext";
import { en, type MessageKey } from "../i18n/messages";

type CustomerPreviewRow = {
  index: number;
  kind?: undefined;
  record: Record<string, any>;
  duplicate: DuplicateMatch<Customer> | null;
  action: "create" | "update" | "skip";
};
type JobPreviewRow = {
  index: number;
  kind: "job";
  company_id: string;
  record: ReturnType<typeof jobFromIcsEvent>;
  duplicate: DuplicateMatch<Job> | null;
  review_label: "personal" | "review" | "job";
  review_reason: string;
  action: "create" | "update" | "skip";
};
type PreviewRow = CustomerPreviewRow | JobPreviewRow;

// Ported verbatim from app.js — the whole Import Center flow (CSV/Sheets/ICS/ZIP
// upload -> field mapping -> dedupe preview -> commit), including the calendar
// personal/work classification and per-row company reassignment for .ics imports.
export default function ImportCenter() {
  const { activeCompanyId, activeCompany, companies, services } = useCompany();
  const { t, tn } = useT();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { data: history = [] } = useImportsHistory(activeCompanyId);
  const invalidate = useInvalidateCompanyData(activeCompanyId);
  const queryClient = useQueryClient();
  const { has: hasPermission, isLoading: permissionsLoading } = usePermissions();

  const [type, setType] = useState<ImportSourceType>("csv");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [sheetUrl, setSheetUrl] = useState(() => (activeCompanyId && settings?.google_sheets.source_urls?.[activeCompanyId]) || "");
  const [committing, setCommitting] = useState(false);
  const [connectingSheet, setConnectingSheet] = useState(false);
  const jobsMapCache = useRef<Record<string, Job[]>>({});
  const servicesMapCache = useRef<Record<string, string[]>>({});

  // Also hidden from Shell's nav for the same reason — this is a
  // belt-and-suspenders guard against a direct /import link.
  if (permissionsLoading) return null;
  if (!hasPermission("import")) return <Navigate to="/dashboard" replace />;

  const resetImportState = () => {
    setType("csv"); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setPreview([]);
  };

  function changeType(nextType: ImportSourceType) {
    setType(nextType);
    setMapping(autoMapHeaders(headers, nextType));
    setPreview([]);
  }

  async function loadCSV(file: File) {
    const text = await file.text();
    const parsed = parseCSV(text);
    const nextHeaders = (parsed[0] || []).map(h => h.trim());
    setFileName(file.name);
    setHeaders(nextHeaders);
    setRows(parsed.slice(1));
    setMapping(autoMapHeaders(nextHeaders, type));
    setPreview([]);
    toast(t("imp.t.csvLoaded"));
  }

  async function loadICS(text: string, icsFileName: string) {
    if (!activeCompanyId) return;
    const events = parseICS(text);
    setType("calendar_ics");
    setFileName(icsFileName || "Google Calendar ICS");
    setHeaders([]); setRows([]); setMapping({});

    const [jobEntries, serviceEntries] = await Promise.all([
      Promise.all(companies.map(async c => [c.id, await listJobs(c.id)] as const)),
      Promise.all(companies.map(async c => [c.id, await listServices(c.id)] as const))
    ]);
    jobsMapCache.current = Object.fromEntries(jobEntries);
    servicesMapCache.current = Object.fromEntries(serviceEntries);

    const previewRows: PreviewRow[] = events
      .map((event, index): JobPreviewRow => {
        const record = jobFromIcsEvent(event, activeCompanyId, services);
        const companyId = record.company_id || activeCompanyId;
        const duplicate = findDuplicateJob(record, jobsMapCache.current[companyId] || []);
        const review = classifyCalendarEvent(record, event);
        return {
          index, kind: "job", company_id: companyId, record, duplicate,
          review_label: review.label, review_reason: review.reason,
          action: review.skip ? "skip" : duplicate ? "update" : "create"
        };
      })
      .filter(row => row.record.title || row.record.scheduled_date || row.record.address);
    setPreview(previewRows);
    toast(tn("imp.t.calendarReady", previewRows.length));
  }

  async function loadImportFile(file: File | null) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      try {
        const text = await extractFirstIcsFromZip(await file.arrayBuffer());
        await loadICS(text, file.name);
      } catch {
        toastError(t("imp.t.zipBad"));
      }
      return;
    }
    if (name.endsWith(".ics") || file.type === "text/calendar") {
      const text = await file.text();
      await loadICS(text, file.name);
      return;
    }
    await loadCSV(file);
  }

  async function loadGoogleSheetCsv() {
    if (!sheetUrl.trim() || !activeCompanyId || !settings) { toast(t("imp.t.pasteUrl")); return; }
    const csvUrl = toGoogleSheetCsvUrl(sheetUrl.trim());
    if (!csvUrl) { toastError(t("imp.t.badUrl")); return; }
    try {
      const nextSettings = { ...settings, google_sheets: { ...settings.google_sheets, source_urls: { ...settings.google_sheets.source_urls, [activeCompanyId]: sheetUrl.trim() } } };
      await saveIntegrationSettings(nextSettings);
      queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error("Sheet request failed");
      const text = await response.text();
      const parsed = parseCSV(text);
      const nextHeaders = (parsed[0] || []).map(h => h.trim());
      setType("sheets");
      setFileName("Google Sheet import");
      setHeaders(nextHeaders);
      setRows(parsed.slice(1));
      setMapping(autoMapHeaders(nextHeaders, "sheets"));
      setPreview([]);
      toast(t("imp.t.sheetLoaded"));
    } catch {
      toastError(t("imp.t.sheetFailed"));
    }
  }

  // Reads a private (not published-to-web) Google Sheet directly via the
  // Sheets API, using the same per-service OAuth token connectGoogleWorkspace
  // already mints for Calendar/Drive — no "publish to web" step needed, but
  // does need the Google OAuth client configured on Integrations first.
  async function loadPrivateGoogleSheet() {
    if (!sheetUrl.trim() || !activeCompanyId || !settings) { toast(t("imp.t.pasteUrl")); return; }
    const spreadsheetId = extractSpreadsheetId(sheetUrl.trim());
    if (!spreadsheetId) { toastError(t("imp.t.badUrl")); return; }
    if (!settings.google_oauth.client_id) { toast(t("imp.t.oauthFirst")); return; }
    setConnectingSheet(true);
    try {
      let token = googleAccessTokenFor("sheets");
      if (!token) {
        const result = await connectGoogleWorkspace(settings.google_oauth.client_id, "sheets");
        token = result.accessToken;
      }
      const values = await fetchPrivateSheetValues(token, spreadsheetId);
      const nextSettings = { ...settings, google_sheets: { ...settings.google_sheets, source_urls: { ...settings.google_sheets.source_urls, [activeCompanyId]: sheetUrl.trim() } } };
      await saveIntegrationSettings(nextSettings);
      queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
      const nextHeaders = (values[0] || []).map(h => h.trim());
      setType("sheets");
      setFileName("Google Sheet import (private)");
      setHeaders(nextHeaders);
      setRows(values.slice(1));
      setMapping(autoMapHeaders(nextHeaders, "sheets"));
      setPreview([]);
      toast(t("imp.t.privateLoaded"));
    } catch (error) {
      toastError(errorMessage(error, t("imp.t.privateFailed")));
    } finally {
      setConnectingSheet(false);
    }
  }

  function buildPreview() {
    if (!activeCompanyId) return;
    const previewRows: PreviewRow[] = rows
      .map((row, index): CustomerPreviewRow => {
        const record = mappedRecord(row, headers, mapping, activeCompanyId, IMPORT_PRESETS[type].label);
        const duplicate = findDuplicate(record, customers);
        return { index, record, duplicate, action: duplicate ? "update" : "create" };
      })
      .filter(r => r.record.name || r.record.phone || r.record.email || r.record.address);
    setPreview(previewRows);
  }

  function setRowAction(index: number, action: PreviewRow["action"]) {
    setPreview(prev => prev.map(item => (item.index === index ? { ...item, action } : item)));
  }

  function setImportRowCompany(index: number, companyId: string) {
    setPreview(prev => prev.map(item => {
      if (item.index !== index || item.kind !== "job") return item;
      const duplicate = findDuplicateJob(item.record, jobsMapCache.current[companyId] || []);
      return { ...item, company_id: companyId, record: { ...item.record, company_id: companyId }, duplicate, action: duplicate ? "update" : "create" };
    }));
  }

  function applyCalendarCleanup(mode: "skip-personal" | "skip-review" | "restore-work") {
    setPreview(prev => prev.map(item => {
      if (item.kind !== "job") return item;
      if (mode === "skip-personal" && item.review_label === "personal") return { ...item, action: "skip" };
      if (mode === "skip-review" && item.review_label === "review") return { ...item, action: "skip" };
      if (mode === "restore-work" && item.review_label === "job") return { ...item, action: item.duplicate ? "update" : "create" };
      return item;
    }));
  }

  async function commitImport() {
    if (!activeCompanyId) return;
    setCommitting(true);
    let created = 0, updated = 0, skipped = 0;
    const importCompanyCounts: Record<string, { created: number; updated: number; skipped: number }> = {};
    try {
      for (const item of preview) {
        if (item.action === "skip") {
          skipped++;
          if (item.kind === "job") {
            const companyId = item.company_id || item.record.company_id || activeCompanyId;
            importCompanyCounts[companyId] = importCompanyCounts[companyId] || { created: 0, updated: 0, skipped: 0 };
            importCompanyCounts[companyId].skipped++;
          }
          continue;
        }
        if (item.kind === "job") {
          const companyId = item.company_id || item.record.company_id || activeCompanyId;
          importCompanyCounts[companyId] = importCompanyCounts[companyId] || { created: 0, updated: 0, skipped: 0 };
          const defaultService = (servicesMapCache.current[companyId] || [])[0] || "";
          if (item.action === "update" && item.duplicate) {
            await updateJob(item.duplicate.match.id, companyId, cleanJob(item.record, companyId, defaultService));
            updated++; importCompanyCounts[companyId].updated++;
            continue;
          }
          const job = cleanJob(item.record, companyId, defaultService);
          await insertJob({ ...job, id: uid("job"), created_at: now() });
          created++; importCompanyCounts[companyId].created++;
          continue;
        }
        if (item.action === "update" && item.duplicate) {
          await updateCustomer(item.duplicate.match.id, activeCompanyId, cleanCustomer(item.record, activeCompanyId, services[0] || ""));
          updated++;
          continue;
        }
        const customer = cleanCustomer(item.record, activeCompanyId, services[0] || "");
        const inserted = await insertCustomer({ ...customer, id: uid("cust"), created_at: now() });
        await insertLead(leadFromCustomer(inserted));
        created++;
      }

      if (type === "calendar_ics" && Object.keys(importCompanyCounts).length) {
        for (const [companyId, counts] of Object.entries(importCompanyCounts)) {
          await insertImport({
            company_id: companyId, file_name: fileName || "Calendar import",
            source_type: IMPORT_PRESETS[type]?.label || "Google Calendar ICS",
            created_count: counts.created, updated_count: counts.updated, skipped_count: counts.skipped,
            row_count: counts.created + counts.updated + counts.skipped
          });
        }
      } else {
        await insertImport({
          company_id: activeCompanyId, file_name: fileName || "Import",
          source_type: IMPORT_PRESETS[type]?.label || "Import",
          created_count: created, updated_count: updated, skipped_count: skipped, row_count: preview.length
        });
      }

      resetImportState();
      invalidate();
      toast(t("imp.t.done", { created, updated, skipped }));
    } catch (error) {
      toastError(errorMessage(error, t("imp.t.saveFailed")));
    } finally {
      setCommitting(false);
    }
  }

  const isCalendarImport = type === "calendar_ics";
  const presetLabel = (k: string) => (`imp.preset.${k}` in en ? t(`imp.preset.${k}` as MessageKey) : IMPORT_PRESETS[k as ImportSourceType]?.label || k);

  return (
    <div className="import-layout">
      <div className="import-main">
        <section className="card">
          <div className="card-h"><div><h3>{t("imp.step1")}</h3><span className="sub">{t("imp.step1Sub", { company: activeCompany?.name || "" })}</span></div></div>
          <div className="card-b">
            <div className="form-row">
              <div className="field">
                <label>{t("imp.source")}</label>
                <Select aria-label={t("imp.source")} value={type} onChange={v => changeType(v as ImportSourceType)} options={Object.keys(IMPORT_PRESETS).map(k => ({ value: k, label: presetLabel(k) }))} />
              </div>
              <div className="field">
                <label>{t("imp.file")}</label>
                <FileButton accept=".csv,.ics,.zip,text/csv,text/calendar,application/zip" onFiles={files => loadImportFile(files?.[0] || null)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="imp-sheet">{t("imp.sheetUrl")}</label>
              <input id="imp-sheet" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder={t("imp.sheetPlaceholder")} />
              <div className="inline-actions" style={{ marginTop: 8 }}>
                <button className="btn ghost slim" onClick={loadGoogleSheetCsv}>{t("imp.loadPublished")}</button>
                <button className="btn ghost slim" onClick={loadPrivateGoogleSheet} disabled={connectingSheet}>
                  {connectingSheet ? t("imp.connecting") : t("imp.loadPrivate")}
                </button>
              </div>
            </div>
          </div>
        </section>

        {isCalendarImport && preview.length ? (
          <PreviewTable
            preview={preview} isCalendarImport companies={companies}
            onAction={setRowAction} onCompanyChange={setImportRowCompany} onCleanup={applyCalendarCleanup}
            onCommit={commitImport} committing={committing} companyName={activeCompany?.name || ""}
          />
        ) : headers.length ? (
          <>
            <section className="card">
              <div className="card-h"><div><h3>{t("imp.step2")}</h3><span className="sub">{t("imp.step2Sub")}</span></div></div>
              <div className="card-b">
                <div className="mapping-grid">
                  {IMPORT_FIELDS.map(([field, label]) => (
                    <div className="field" key={field}>
                      <label>{`imp.field.${field}` in en ? t(`imp.field.${field}` as MessageKey) : label}</label>
                      <Select
                        aria-label={`imp.field.${field}` in en ? t(`imp.field.${field}` as MessageKey) : label}
                        value={mapping[field] || ""}
                        onChange={v => setMapping(m => ({ ...m, [field]: v }))}
                        options={[{ value: "", label: t("imp.doNotImport") }, ...headers.map(h => ({ value: h, label: h }))]}
                      />
                    </div>
                  ))}
                </div>
                <button className="btn" style={{ marginTop: 16 }} onClick={buildPreview}>{t("imp.preview")}</button>
              </div>
            </section>
            {preview.length > 0 && (
              <PreviewTable
                preview={preview} isCalendarImport={false} companies={companies}
                onAction={setRowAction} onCompanyChange={setImportRowCompany} onCleanup={applyCalendarCleanup}
                onCommit={commitImport} committing={committing} companyName={activeCompany?.name || ""}
              />
            )}
          </>
        ) : (
          <section className="card"><div className="card-b"><EmptyState icon={Upload}>{t("imp.emptyHint")}</EmptyState></div></section>
        )}
      </div>

      <section className="card self-start">
        <div className="card-h"><h3>{t("imp.history")}</h3><span className="sub">{history.length}</span></div>
        <div className="card-b">
          {history.length ? (
            <ul className="history-list">
              {history.map(h => (
                <li key={h.id}>
                  <b>{h.file_name}</b>
                  <span className="sub">{t("imp.historyLine", { source: h.source_type, created: h.created_count, updated: h.updated_count, skipped: h.skipped_count })}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Upload}>{t("imp.noHistory")}</EmptyState>}
        </div>
      </section>
    </div>
  );
}

const PREVIEW_LIMIT = 80;

function PreviewTable({ preview, isCalendarImport, companies, onAction, onCompanyChange, onCleanup, onCommit, committing, companyName }: {
  preview: PreviewRow[];
  isCalendarImport: boolean;
  companies: { id: string; name: string }[];
  onAction: (index: number, action: PreviewRow["action"]) => void;
  onCompanyChange: (index: number, companyId: string) => void;
  onCleanup: (mode: "skip-personal" | "skip-review" | "restore-work") => void;
  onCommit: () => void;
  committing: boolean;
  companyName: string;
}) {
  const { t } = useT();
  const counts = preview.reduce((acc: Record<string, number>, row) => { acc[row.action] = (acc[row.action] || 0) + 1; return acc; }, {});
  const reviewCounts = preview.reduce((acc: Record<string, number>, row) => {
    if (row.kind !== "job") return acc;
    const label = row.review_label || "job";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const tr = (prefix: string, value: string) => (`${prefix}.${value}` in en ? t(`${prefix}.${value}` as MessageKey) : value);

  return (
    <section className="card">
      <div className="card-h"><h3>{t("imp.step3")}</h3></div>
      <div className="card-b">
        <KpiStrip items={[
          { label: t("imp.kpi.create"), value: counts.create || 0, hint: t("imp.kpi.createHint"), tone: "green" },
          { label: t("imp.kpi.update"), value: counts.update || 0, hint: t("imp.kpi.updateHint"), tone: "blue" },
          { label: t("imp.kpi.skip"), value: counts.skip || 0, hint: t("imp.kpi.skipHint"), tone: "slate" }
        ]} />
        {isCalendarImport && (
          <div className="notice-box">
            <p>{t("imp.calendarNote")}</p>
            <div className="inline-actions">
              <button className="btn ghost slim" onClick={() => onCleanup("skip-personal")}>{t("imp.skipPersonal")}</button>
              <button className="btn ghost slim" onClick={() => onCleanup("skip-review")}>{t("imp.skipReview")}</button>
              <button className="btn ghost slim" onClick={() => onCleanup("restore-work")}>{t("imp.restoreWork")}</button>
            </div>
            <span className="sub">{t("imp.reviewCounts", { personal: reviewCounts.personal || 0, review: reviewCounts.review || 0, job: reviewCounts.job || 0 })}</span>
          </div>
        )}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("imp.col.action")}</th>
                {isCalendarImport && <><th>{t("imp.col.company")}</th><th>{t("imp.col.review")}</th></>}
                <th>{t("imp.col.name")}</th><th>{t("imp.col.contact")}</th><th>{t("imp.col.duplicate")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, PREVIEW_LIMIT).map(row => (
                <tr key={row.index}>
                  <td style={{ minWidth: 170 }}>
                    <Select
                      aria-label={t("imp.col.action")}
                      value={row.action}
                      onChange={v => onAction(row.index, v as PreviewRow["action"])}
                      options={[
                        { value: "create", label: t("imp.action.create") },
                        { value: "update", label: t("imp.action.update"), disabled: !row.duplicate },
                        { value: "skip", label: t("imp.action.skip") }
                      ]}
                    />
                  </td>
                  {isCalendarImport && row.kind === "job" && (
                    <>
                      <td style={{ minWidth: 170 }}>
                        <Select aria-label={t("imp.col.company")} value={row.company_id} onChange={v => onCompanyChange(row.index, v)} options={companies.map(c => ({ value: c.id, label: c.name }))} />
                      </td>
                      <td>
                        <span className={`badge-tone tone-${row.review_label === "personal" ? "slate" : row.review_label === "review" ? "amber" : "green"}`}>{tr("imp.label", row.review_label || "job")}</span>
                        <div className="sub">{tr("imp.reason", row.review_reason || "Has job details")}</div>
                      </td>
                    </>
                  )}
                  <td><b className="cell-strong">{row.kind === "job" ? row.record.title : row.record.name}</b></td>
                  <td className="sub">{row.kind === "job" ? [row.record.scheduled_date, row.record.address, row.record.city].filter(Boolean).join(" · ") : row.record.phone || row.record.email || ""}</td>
                  <td>
                    {row.duplicate
                      ? <>{(row.duplicate.match as any).name || (row.duplicate.match as any).title} <span className="sub">({row.duplicate.reasons.map(r => tr("dup", r)).join(", ")})</span></>
                      : <span className="cell-missing">{t("imp.noMatch")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.length > PREVIEW_LIMIT && <p className="sub" style={{ marginTop: 8 }}>{t("imp.showing", { count: PREVIEW_LIMIT })}</p>}
        <button className="btn" style={{ marginTop: 14 }} onClick={onCommit} disabled={committing}>
          {committing ? t("imp.saving") : isCalendarImport ? t("imp.saveCalendar") : t("imp.saveTo", { company: companyName })}
        </button>
      </div>
    </section>
  );
}
