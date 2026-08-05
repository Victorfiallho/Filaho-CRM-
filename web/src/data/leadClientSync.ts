// Ported verbatim from app.js (upsertClientFromLead). "Creating or editing a lead
// should create/update the matching Client automatically" (schema.md Sprint 1
// rule) — same preferredClientId -> dedupe -> create fallback order as before.
import { findDuplicate, mergeClientData } from "../domain/dedupe";
import { cleanCustomer } from "../domain/records";
import { now, uid } from "../domain/format";
import type { Customer } from "../domain/types";
import { getCustomer, insertCustomer, listCustomers, updateCustomer } from "./customers";

export async function upsertClientFromLead(
  leadData: Partial<Customer> & Record<string, unknown>,
  companyId: string,
  defaultServiceType: string,
  preferredClientId?: string
): Promise<Customer> {
  const patch = cleanCustomer(
    { ...leadData, status: "active", source: (leadData.source as string) || "Lead" },
    companyId,
    defaultServiceType
  );

  if (preferredClientId) {
    const existing = await getCustomer(preferredClientId, companyId);
    if (existing) {
      const merged = mergeClientData(existing, patch);
      return updateCustomer(existing.id, companyId, merged);
    }
  }

  const existingCustomers = await listCustomers(companyId);
  const duplicate = findDuplicate(patch, existingCustomers);
  if (duplicate) {
    const merged = mergeClientData(duplicate.match, patch);
    return updateCustomer(duplicate.match.id, companyId, merged);
  }

  return insertCustomer({ ...patch, id: uid("cust"), created_at: now() });
}
