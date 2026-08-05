// Ported verbatim from app.js — Google Calendar .ics parsing, personal/work
// classification keyword lists, and company-routing heuristics for calendar
// imports. Mechanical changes only: `services()`/`activeCompanyId` globals become
// explicit parameters (see the comment on jobFromIcsEvent for a quirk this
// preserves on purpose).
import { normKey, norm } from "./format";

export interface IcsEvent {
  UID?: string;
  SUMMARY?: string;
  DESCRIPTION?: string;
  LOCATION?: string;
  DTSTART?: string;
  STATUS?: string;
  [key: string]: string | undefined;
}

export function decodeIcsValue(value: string): string {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export function parseICS(text: string): IcsEvent[] {
  const unfolded = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: IcsEvent | null = null;
  lines.forEach(line => {
    if (line === "BEGIN:VEVENT") { current = {}; return; }
    if (line === "END:VEVENT") { if (current) events.push(current); current = null; return; }
    if (!current) return;
    const split = line.indexOf(":");
    if (split < 0) return;
    const rawKey = line.slice(0, split);
    const key = rawKey.split(";")[0].toUpperCase();
    const value = decodeIcsValue(line.slice(split + 1));
    current[key] = current[key] ? `${current[key]}\n${value}` : value;
  });
  return events;
}

export function parseAddressParts(location: string) {
  const parts = String(location || "").split(",").map(p => p.trim()).filter(Boolean);
  const stateZip = parts[2] || "";
  const match = stateZip.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  return {
    address: parts[0] || "",
    city: parts[1] || "",
    state: match?.[1] || "",
    zip: match?.[2] || normZipLocal(location)
  };
}
function normZipLocal(v: unknown) { return (norm(v).match(/\d{5}/) || [""])[0]; }

export function dateFromIcs(value?: string): string {
  const raw = String(value || "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const normalized = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function valueFromText(text: string): number {
  const dollar = String(text || "").match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  if (dollar) return Number(dollar[1].replace(/,/g, "")) || 0;
  const total = String(text || "").match(/\bTotal\s*-\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  return total ? Number(total[1].replace(/,/g, "")) || 0 : 0;
}

export function serviceFromTitle(title: string, companyServices: string[]): string {
  const normalized = normKey(title);
  return companyServices.find(service => normalized.includes(normKey(service))) || companyServices[0] || "";
}

export function customerNameFromTitle(title: string): string {
  return String(title || "").split(/\s+-\s+/)[0].trim();
}

export function companyFromCalendarEvent(title: string, description: string, fallbackCompanyId: string): string {
  const text = normKey(`${title || ""} ${description || ""}`);
  if (/\barca\b/.test(text)) return "arca_cabinets";
  if (text.includes("floor") || text.includes("flooring") || text.includes("tile") || text.includes("carpet install")) return "peach_state_flooring";
  if (text.includes("cabinet") || text.includes("vanity") || text.includes("refacing") || text.includes("kitchen")) return "wish_cabinets";
  if (text.includes("clean") || text.includes("carpet") || text.includes("move in") || text.includes("move out") || text.includes("deep")) return "peach_fresh";
  return fallbackCompanyId || "peach_fresh";
}

// NOTE: `serviceFromTitle` here intentionally uses the *currently active* company's
// service list, not the service list of the company this event gets routed to by
// `companyFromCalendarEvent`. That mismatch exists in the original app.js too
// (service_type is resolved before company routing is applied) — preserved as-is
// rather than "fixed", per the no-business-rule-changes constraint.
export function jobFromIcsEvent(event: IcsEvent, activeCompanyId: string, activeCompanyServices: string[]) {
  const parts = parseAddressParts(event.LOCATION || "");
  const title = event.SUMMARY || "Calendar event";
  const companyId = companyFromCalendarEvent(title, event.DESCRIPTION || "", activeCompanyId);
  return {
    company_id: companyId,
    source: "Google Calendar ICS",
    source_uid: event.UID || "",
    title,
    customer_name: customerNameFromTitle(title),
    status: event.STATUS?.toLowerCase() === "cancelled" ? "cancelled" : "scheduled",
    service_type: serviceFromTitle(title, activeCompanyServices),
    scheduled_date: dateFromIcs(event.DTSTART),
    estimated_value: valueFromText(`${event.DESCRIPTION || ""}\n${title}`),
    address: parts.address,
    city: parts.city,
    state: parts.state,
    zip: parts.zip,
    notes: event.DESCRIPTION || "",
    lat: "" as const,
    lng: "" as const,
    drive_folder_url: ""
  };
}

const PERSONAL_RULES: [string, string][] = [
  ["culto", "Personal/church event"],
  ["walquiria", "Personal/church event"],
  ["valquiria", "Personal/church event"],
  ["valqu", "Personal/church event"],
  ["marriage license", "Personal document"],
  ["casamento", "Personal event"],
  ["birthday", "Birthday/personal"],
  ["christmas", "Holiday"],
  ["thanksgiving", "Holiday"],
  ["home office", "Internal/admin, not customer job"],
  ["the home office", "Internal/admin, not customer job"],
  ["cutting grass", "Personal/home task"],
  ["camping", "Personal event"],
  ["washer and dryer", "Personal/home task"],
  ["reuniao planejamento financeiro", "Personal/admin"],
  ["planejamento financeiro", "Personal/admin"]
];

const WORK_SIGNALS = [
  "clean", "cleaning", "carpet", "rug", "upholstery", "cabinet", "cabinets", "kitchen", "bathroom",
  "closet", "install", "installation", "measurement", "inspection", "floor", "flooring", "tile",
  "drywall", "mudroom", "removal", "client", "yelp", "peach fresh", "wish cabinets", "peach crafted"
];

export function classifyCalendarEvent(
  record: { title?: string; notes?: string; address?: string; estimated_value?: number },
  event: IcsEvent
): { label: "personal" | "review" | "job"; reason: string; skip: boolean } {
  const text = normKey(`${record.title || ""} ${record.notes || ""} ${event.LOCATION || ""}`);
  if (text === "off") return { label: "personal", reason: "Time off", skip: true };
  const personal = PERSONAL_RULES.find(([needle]) => text === needle || text.includes(needle));
  if (personal) return { label: "personal", reason: personal[1], skip: true };
  if (!/[a-z0-9]/.test(text)) return { label: "personal", reason: "No usable job text", skip: true };

  const hasWorkSignal = WORK_SIGNALS.some(signal => text.includes(signal));
  const hasJobDetails = Boolean(record.address || record.estimated_value || hasWorkSignal);
  if (!hasJobDetails) return { label: "review", reason: "No address/service/value found", skip: false };
  return { label: "job", reason: hasWorkSignal ? "Work keywords found" : "Has job details", skip: false };
}

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function zipEntries(view: DataView, buffer: ArrayBuffer, decoder: TextDecoder): ZipEntry[] {
  const entries: ZipEntry[] = [];
  for (let pos = 0; pos < view.byteLength - 46; pos++) {
    if (view.getUint32(pos, true) !== 0x02014b50) continue;
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const nameStart = pos + 46;
    const name = decoder.decode(buffer.slice(nameStart, nameStart + fileNameLength));
    entries.push({ name, method, compressedSize, offset });
    pos = nameStart + fileNameLength + extraLength + commentLength - 1;
  }
  if (entries.length) return entries;
  for (let pos = 0; pos < view.byteLength - 30; pos++) {
    if (view.getUint32(pos, true) !== 0x04034b50) continue;
    const method = view.getUint16(pos + 8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const fileNameLength = view.getUint16(pos + 26, true);
    const extraLength = view.getUint16(pos + 28, true);
    const nameStart = pos + 30;
    const name = decoder.decode(buffer.slice(nameStart, nameStart + fileNameLength));
    entries.push({ name, method, compressedSize, offset: pos });
    pos = nameStart + fileNameLength + extraLength + Math.max(compressedSize, 0) - 1;
  }
  return entries;
}

export async function extractFirstIcsFromZip(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  for (const entry of zipEntries(view, buffer, decoder)) {
    if (!entry.name.toLowerCase().endsWith(".ics")) continue;
    const localFileNameLength = view.getUint16(entry.offset + 26, true);
    const localExtraLength = view.getUint16(entry.offset + 28, true);
    const dataStart = entry.offset + 30 + localFileNameLength + localExtraLength;
    const data = buffer.slice(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) return decoder.decode(data);
    if (entry.method === 8) {
      if (!("DecompressionStream" in window)) throw new Error("ZIP decompression unavailable");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return decoder.decode(await new Response(stream).arrayBuffer());
    }
    throw new Error("Unsupported ZIP compression");
  }
  throw new Error("No .ics file found");
}
