// Maps import columns to fields (auto-guessed from headers) and builds
// records from rows.
import { IMPORT_FIELDS, IMPORT_PRESETS, type ImportSourceType } from "./constants";
import { norm, normKey, normZip } from "./format";
import type { Customer, PipelineStage } from "./types";

// Portuguese headers, for any source. Matching is by substring, so an alias
// must not appear inside another field's header ("cliente" would grab
// "E-mail do cliente").
const COMMON_ALIASES: Record<string, string[]> = {
  name: ["nome"],
  phone: ["telefone", "celular", "whatsapp"],
  email: ["e mail"],
  address: ["endereco"],
  city: ["cidade"],
  state: ["estado"],
  zip: ["cep", "zip code", "postal"],
  service_type: ["servico"],
  status: ["situacao"],
  stage_id: ["etapa", "fase", "stage"],
  value: ["valor"],
  notes: ["observa", "notas"],
  drive_folder_url: ["pasta do drive"]
};

export function autoMapHeaders(headers: string[], sourceType: ImportSourceType): Record<string, string> {
  const presetAliases = IMPORT_PRESETS[sourceType]?.aliases || {};
  const mapping: Record<string, string> = {};
  IMPORT_FIELDS.forEach(([field, label]) => {
    const aliases = [field, label, ...(presetAliases[field] || []), ...(COMMON_ALIASES[field] || [])].map(normKey);
    const match = headers.find(h => aliases.some(a => normKey(h) === a || normKey(h).includes(a)));
    if (match) mapping[field] = match;
  });
  return mapping;
}

export function stageFromValue(value: unknown): string {
  const v = normKey(value);
  if (v.includes("won") || v.includes("closed") || v.includes("complete") || v.includes("ganh") || v.includes("fechad") || v.includes("conclu")) return "won";
  if (v.includes("schedule") || v.includes("book") || v.includes("agend")) return "scheduled";
  if (v.includes("estimate") || v.includes("quote") || v.includes("orcamento") || v.includes("proposta")) return "estimate";
  if (v.includes("contact") || v.includes("contat")) return "contacted";
  return "new";
}

// Companies rename and add stages, so the file's value is matched against
// the company's own stages (id or name) before falling back to keywords.
// Anything unknown lands in the first open stage.
export function resolveImportStage(value: unknown, stages: PipelineStage[]): string {
  if (!stages.length) return stageFromValue(value);
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const firstOpen = ordered.find(s => s.type !== "won" && s.type !== "lost")?.id || ordered[0].id;
  const key = normKey(value);
  if (!key) return firstOpen;
  const exact = ordered.find(s => normKey(s.id) === key || normKey(s.name) === key);
  if (exact) return exact.id;
  if (key.includes("lost") || key.includes("perdid")) return ordered.find(s => s.type === "lost")?.id || firstOpen;
  const guess = stageFromValue(value);
  if (guess === "won") return ordered.find(s => s.type === "won")?.id || firstOpen;
  return ordered.some(s => s.id === guess) ? guess : firstOpen;
}

export function mappedRecord(
  row: string[],
  headers: string[],
  mapping: Record<string, string>,
  companyId: string,
  sourceLabel: string,
  stages: PipelineStage[] = []
): Record<string, any> {
  const record: Record<string, any> = { company_id: companyId, source: sourceLabel };
  Object.entries(mapping).forEach(([field, header]) => {
    if (!header) return;
    const index = headers.indexOf(header);
    record[field] = norm(row[index]);
  });
  if (!record.name && record.email) record.name = record.email.split("@")[0];
  record.zip = normZip(record.zip);
  record.stage_id = resolveImportStage(record.stage_id || record.status, stages);
  record.status = record.status || "active";
  record.value = Number(String(record.value || "0").replace(/[^0-9.]/g, "")) || 0;
  return record;
}

const UPDATABLE_CLIENT_FIELDS = [
  "name", "phone", "email", "address", "city", "state", "zip", "service_type", "status", "notes", "drive_folder_url", "lat", "lng"
] as const;

// Updating an existing client only writes the cells the file actually
// filled; a blank or unmapped column keeps what the CRM already has.
// `source` is left alone: it records how the client first came in.
export function importUpdatePatch(record: Record<string, any>, mapping: Record<string, string>): Partial<Customer> {
  const patch: Record<string, unknown> = {};
  UPDATABLE_CLIENT_FIELDS.forEach(field => {
    if (!mapping[field] || !norm(record[field])) return;
    patch[field] = field === "lat" || field === "lng" ? Number(record[field]) || "" : record[field];
  });
  return patch as Partial<Customer>;
}

// Header row the auto-mapping recognizes, plus two example rows.
export function importTemplateCsvRows(stages: PipelineStage[], serviceNames: string[]): { headers: string[]; rows: string[][] } {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const stageA = ordered[0]?.name || "New";
  const stageB = ordered[1]?.name || stageA;
  const serviceA = serviceNames[0] || "Kitchen cabinets";
  const serviceB = serviceNames[1] || serviceA;
  return {
    headers: ["Name", "Phone", "Email", "Address", "City", "State", "ZIP", "Service type", "Pipeline stage", "Estimated value", "Notes"],
    rows: [
      ["John Smith", "(555) 123-4567", "john@example.com", "123 Main St", "Austin", "TX", "78701", serviceA, stageA, "15000", "Referral from a neighbor"],
      ["Mary Johnson", "555-987-6543", "mary@example.com", "45 Oak Ave", "Dallas", "TX", "75201", serviceB, stageB, "8000", ""]
    ]
  };
}
