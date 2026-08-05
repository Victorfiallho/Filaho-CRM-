// Ported verbatim from app.js (findDuplicate, findDuplicateJob, mergeClientData).
// Same matching rules, same field priority. The only mechanical change from the
// original: instead of reading the global `db.customers`/`db.jobs` filtered by
// activeCompanyId, the already-company-scoped candidate list is passed in — that
// scoping used to happen inline via a closure over `activeCompanyId`, now it happens
// where the data is fetched (src/data/*).
import { normAddress, normEmail, normName, normPhone, normZip } from "./format";
import type { Customer, Job } from "./types";

export interface DuplicateMatch<T> {
  match: T;
  reasons: string[];
}

export function findDuplicate(record: Partial<Customer>, existingCustomers: Customer[]): DuplicateMatch<Customer> | null {
  for (const existing of existingCustomers) {
    const reasons: string[] = [];
    if (record.phone && normPhone(record.phone) && normPhone(record.phone) === normPhone(existing.phone)) reasons.push("phone");
    if (record.email && normEmail(record.email) && normEmail(record.email) === normEmail(existing.email)) reasons.push("email");
    if (record.address && normAddress(record.address) && normAddress(record.address) === normAddress(existing.address)) reasons.push("address");
    if (record.name && record.zip && normName(record.name) === normName(existing.name) && normZip(record.zip) === normZip(existing.zip)) reasons.push("name + ZIP");
    if (reasons.length) return { match: existing, reasons };
  }
  return null;
}

export function findDuplicateJob(record: Partial<Job>, existingJobs: Job[]): DuplicateMatch<Job> | null {
  for (const existing of existingJobs) {
    const reasons: string[] = [];
    if (record.source_uid && existing.source_uid && record.source_uid === existing.source_uid) reasons.push("calendar UID");
    if (record.scheduled_date && existing.scheduled_date === record.scheduled_date && normName(record.title) === normName(existing.title)) reasons.push("title + date");
    if (record.scheduled_date && existing.scheduled_date === record.scheduled_date && record.address && normAddress(record.address) === normAddress(existing.address)) reasons.push("address + date");
    if (reasons.length) return { match: existing, reasons };
  }
  return null;
}

export function mergeClientData(existing: Customer, patch: Partial<Customer>): Partial<Customer> {
  const merged: Partial<Customer> = { ...patch };
  (["name", "phone", "email", "address", "city", "state", "zip", "service_type", "notes", "drive_folder_url", "lat", "lng"] as const)
    .forEach(field => {
      if ((merged[field] === "" || merged[field] == null) && existing[field]) (merged as any)[field] = existing[field];
    });
  merged.status = patch.status || existing.status || "active";
  merged.source = patch.source || existing.source || "Lead";
  return merged;
}
