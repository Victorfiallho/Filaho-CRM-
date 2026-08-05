// Ported verbatim from app.js (mappedRecord, autoMap, stageFromValue). Mechanical
// change only: functions take headers/mapping/companyId/sourceLabel as parameters
// instead of reading the global `importState`/`activeCompanyId`.
import { IMPORT_FIELDS, IMPORT_PRESETS, type ImportSourceType } from "./constants";
import { norm, normKey, normZip } from "./format";

export function autoMapHeaders(headers: string[], sourceType: ImportSourceType): Record<string, string> {
  const presetAliases = IMPORT_PRESETS[sourceType]?.aliases || {};
  const mapping: Record<string, string> = {};
  IMPORT_FIELDS.forEach(([field, label]) => {
    const aliases = [field, label, ...(presetAliases[field] || [])].map(normKey);
    const match = headers.find(h => aliases.some(a => normKey(h) === a || normKey(h).includes(a)));
    if (match) mapping[field] = match;
  });
  return mapping;
}

export function stageFromValue(value: unknown): string {
  const v = normKey(value);
  if (v.includes("won") || v.includes("closed") || v.includes("complete")) return "won";
  if (v.includes("schedule") || v.includes("book")) return "scheduled";
  if (v.includes("estimate") || v.includes("quote")) return "estimate";
  if (v.includes("contact")) return "contacted";
  return "new";
}

export function mappedRecord(
  row: string[],
  headers: string[],
  mapping: Record<string, string>,
  companyId: string,
  sourceLabel: string
): Record<string, any> {
  const record: Record<string, any> = { company_id: companyId, source: sourceLabel };
  Object.entries(mapping).forEach(([field, header]) => {
    if (!header) return;
    const index = headers.indexOf(header);
    record[field] = norm(row[index]);
  });
  if (!record.name && record.email) record.name = record.email.split("@")[0];
  record.zip = normZip(record.zip);
  record.stage_id = stageFromValue(record.stage_id || record.status);
  record.status = record.status || "active";
  record.value = Number(String(record.value || "0").replace(/[^0-9.]/g, "")) || 0;
  return record;
}
