import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, type LucideIcon, PlusCircle, SkipForward, Upload } from "lucide-react";
import { useRef, useState } from "react";
import Select from "../components/Select";
import { useCustomers, useImportsHistory, useIntegrationSettings, useInvalidateCompanyData } from "../data/hooks";
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
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";

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
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { data: history = [] } = useImportsHistory(activeCompanyId);
  const invalidate = useInvalidateCompanyData(activeCompanyId);
  const queryClient = useQueryClient();

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
    toast("CSV loaded. Review mapping.");
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
    toast(`${previewRows.length} calendar event${previewRows.length === 1 ? "" : "s"} ready to preview.`);
  }

  async function loadImportFile(file: File | null) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      try {
        const text = await extractFirstIcsFromZip(await file.arrayBuffer());
        await loadICS(text, file.name);
      } catch {
        toast("Could not read that ZIP. Upload the .ics file inside it.");
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
    if (!sheetUrl.trim() || !activeCompanyId || !settings) { toast("Paste a Google Sheet URL first."); return; }
    const csvUrl = toGoogleSheetCsvUrl(sheetUrl.trim());
    if (!csvUrl) { toast("Could not read that Google Sheet URL."); return; }
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
      toast("Google Sheet loaded. Review mapping.");
    } catch {
      toast("Could not load Sheet. Publish it as CSV or share it publicly first.");
    }
  }

  // Reads a private (not published-to-web) Google Sheet directly via the
  // Sheets API, using the same per-service OAuth token connectGoogleWorkspace
  // already mints for Calendar/Drive — no "publish to web" step needed, but
  // does need the Google OAuth client configured on Integrations first.
  async function loadPrivateGoogleSheet() {
    if (!sheetUrl.trim() || !activeCompanyId || !settings) { toast("Paste a Google Sheet URL first."); return; }
    const spreadsheetId = extractSpreadsheetId(sheetUrl.trim());
    if (!spreadsheetId) { toast("Could not read that Google Sheet URL."); return; }
    if (!settings.google_oauth.client_id) { toast("Import the Google OAuth JSON in Integrations first."); return; }
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
      toast("Private Google Sheet loaded. Review mapping.");
    } catch (error) {
      toast(errorMessage(error, "Could not load that private Sheet."));
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
      toast(`${created} created, ${updated} updated, ${skipped} skipped.`);
    } catch (error) {
      toast(errorMessage(error, "Could not save the import."));
    } finally {
      setCommitting(false);
    }
  }

  const isCalendarImport = type === "calendar_ics";

  return (
    <div className="grid two">
      <section className="card">
        <div className="card-h"><h3>CSV Import Center</h3><span className="sub">Imports into {activeCompany?.name} only</span></div>
        <div className="card-b">
          <div className="form-row">
            <div className="field">
              <label>Import source</label>
              <Select value={type} onChange={v => changeType(v as ImportSourceType)} options={Object.entries(IMPORT_PRESETS).map(([k, p]) => ({ value: k, label: p.label }))} />
            </div>
            <div className="field">
              <label>CSV, ICS, or Calendar ZIP file</label>
              <input type="file" accept=".csv,.ics,.zip,text/csv,text/calendar,application/zip" onChange={e => loadImportFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <div className="field">
            <label>Google Sheets URL</label>
            <div className="inline-actions">
              <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="Paste Google Sheet URL or published CSV link" />
              <button className="btn ghost" onClick={loadGoogleSheetCsv}>Load published CSV</button>
              <button className="btn ghost" onClick={loadPrivateGoogleSheet} disabled={connectingSheet}>
                {connectingSheet ? "Connecting..." : "Connect Google & load private sheet"}
              </button>
            </div>
          </div>

          {isCalendarImport && preview.length ? (
            <PreviewTable
              preview={preview} isCalendarImport companies={companies}
              onAction={setRowAction} onCompanyChange={setImportRowCompany} onCleanup={applyCalendarCleanup}
              onCommit={commitImport} committing={committing} companyName={activeCompany?.name || ""}
            />
          ) : headers.length ? (
            <>
              <div className="grid three">
                {IMPORT_FIELDS.map(([field, label]) => (
                  <div className="field" key={field}>
                    <label>{label}</label>
                    <Select
                      value={mapping[field] || ""}
                      onChange={v => setMapping(m => ({ ...m, [field]: v }))}
                      options={[{ value: "", label: "Do not import" }, ...headers.map(h => ({ value: h, label: h }))]}
                    />
                  </div>
                ))}
              </div>
              <button className="btn ghost" onClick={buildPreview}>Preview before saving</button>
              {preview.length > 0 && (
                <PreviewTable
                  preview={preview} isCalendarImport={false} companies={companies}
                  onAction={setRowAction} onCompanyChange={setImportRowCompany} onCleanup={applyCalendarCleanup}
                  onCommit={commitImport} committing={committing} companyName={activeCompany?.name || ""}
                />
              )}
            </>
          ) : (
            <div className="empty"><Upload />Upload a CSV, Google Calendar .ics, or .ical.zip file to preview.</div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h3>Import history</h3><span className="sub">{history.length} import{history.length === 1 ? "" : "s"}</span></div>
        <div className="card-b">
          {history.length
            ? history.map(h => (
              <p key={h.id}>
                <b>{h.file_name}</b><br />
                <span className="sub">{h.source_type} | {h.created_count} created | {h.updated_count} updated | {h.skipped_count} skipped</span>
              </p>
            ))
            : <div className="empty"><Upload />No imports yet</div>}
        </div>
      </section>
    </div>
  );
}

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
  const counts = preview.reduce((acc: Record<string, number>, row) => { acc[row.action] = (acc[row.action] || 0) + 1; return acc; }, {});
  const reviewCounts = preview.reduce((acc: Record<string, number>, row) => {
    if (row.kind !== "job") return acc;
    const label = row.review_label || "job";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ marginTop: 16 }}>
      <div className="grid three">
        <Kpi icon={PlusCircle} label="Create" value={counts.create || 0} hint="new records" />
        <Kpi icon={CheckCircle2} label="Update" value={counts.update || 0} hint="matched duplicates" />
        <Kpi icon={SkipForward} label="Skip" value={counts.skip || 0} hint="ignored rows" />
      </div>
      {isCalendarImport && (
        <div className="empty" style={{ marginTop: 12 }}>
          This calendar can contain jobs for multiple companies plus personal events. Review Company and Action before saving.
          <div className="inline-actions" style={{ marginTop: 10 }}>
            <button className="btn ghost slim" onClick={() => onCleanup("skip-personal")}>Skip suggested personal</button>
            <button className="btn ghost slim" onClick={() => onCleanup("skip-review")}>Skip needs review</button>
            <button className="btn ghost slim" onClick={() => onCleanup("restore-work")}>Restore work suggestions</button>
          </div>
          <span className="sub">Suggested personal: {reviewCounts.personal || 0} | Needs review: {reviewCounts.review || 0} | Work-like: {reviewCounts.job || 0}</span>
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Action</th>
              {isCalendarImport && <><th>Company</th><th>Review</th></>}
              <th>Name</th><th>Contact</th><th>Duplicate</th>
            </tr>
          </thead>
          <tbody>
            {preview.slice(0, 80).map(row => (
              <tr key={row.index}>
                <td>
                  <Select
                    value={row.action}
                    onChange={v => onAction(row.index, v as PreviewRow["action"])}
                    options={[
                      { value: "create", label: "Create new" },
                      { value: "update", label: "Update existing", disabled: !row.duplicate },
                      { value: "skip", label: "Skip" }
                    ]}
                  />
                </td>
                {isCalendarImport && row.kind === "job" && (
                  <>
                    <td>
                      <Select value={row.company_id} onChange={v => onCompanyChange(row.index, v)} options={companies.map(c => ({ value: c.id, label: c.name }))} />
                    </td>
                    <td><span className="pill">{row.review_label || "job"}</span><br /><span className="sub">{row.review_reason || "Looks like work"}</span></td>
                  </>
                )}
                <td>{row.kind === "job" ? row.record.title : row.record.name}</td>
                <td>{row.kind === "job" ? [row.record.scheduled_date, row.record.address, row.record.city].filter(Boolean).join(" | ") : row.record.phone || row.record.email || ""}</td>
                <td>{row.duplicate ? <>{(row.duplicate.match as any).name || (row.duplicate.match as any).title} <span className="sub">{row.duplicate.reasons.join(", ")}</span></> : <span className="muted">No match</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" style={{ marginTop: 12 }} onClick={onCommit} disabled={committing}>
        {committing ? "Saving..." : isCalendarImport ? "Save calendar import" : `Save import to ${companyName}`}
      </button>
    </div>
  );
}

function Kpi({ label, value, hint, icon: Icon }: { label: string; value: number; hint: string; icon: LucideIcon }) {
  return (
    <section className="card kpi">
      <div className="kpi-icon"><Icon /></div>
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        <div className="hint">{hint}</div>
      </div>
    </section>
  );
}
