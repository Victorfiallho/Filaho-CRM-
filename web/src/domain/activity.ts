// Turns audit_log rows (from the record_audit_log() trigger and
// web/api/admin-users.js) into one plain sentence each: "moved Jane Doe to
// Won", not "Lead updated: Jane Doe". Used by the Dashboard feed, the TopNav
// bell and the Audit Log. An UPDATE row holds {field: {old, new}} for the
// changed columns only; INSERT/DELETE hold the full row.
//
// Sentences come from the "act.*" i18n keys; ctx.t defaults to English.
import { en, translate, type MessageKey } from "../i18n/messages";
import { formatDay, money } from "./format";
import type { AuditLogEntry } from "./types";

// Bookkeeping that changes on its own (saves, calendar syncs, geocoding).
// An update that touched only these isn't news.
export const NOISE_FIELDS = new Set(["updated_at", "lat", "lng", "google_event_id", "source_uid"]);

const ENTITY_NOUN: Record<string, MessageKey> = {
  customers: "act.noun.customers",
  leads: "act.noun.leads",
  jobs: "act.noun.jobs",
  pipeline_stages: "act.noun.pipeline_stages"
};

// Project money tables: shown to owners only, like the finance screens.
const FINANCE_ENTITIES = new Set(["project_financials", "change_orders", "cost_line_items", "transactions", "refunds", "profit_releases", "drive_files", "drive_folders"]);

export function isFinanceActivity(entry: AuditLogEntry): boolean {
  return FINANCE_ENTITIES.has(entry.entity);
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export interface ActivityContext {
  // Current name of a record that still exists (an UPDATE diff usually
  // doesn't carry the name).
  nameFor: (entity: string, id: string) => string | undefined;
  stageName: (stageId: string) => string | undefined;
  userName: (appUserId: string) => string | undefined;
  t?: Translate;
  locale?: string;
}

type Change = { old: unknown; new: unknown };

function isChange(value: unknown): value is Change {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "old" in (value as object) && "new" in (value as object);
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const english: Translate = (key, vars) => translate("en", key, vars);

// Column name to a readable label ("next_action_date" > "follow-up date"),
// else the column name with spaces.
export function fieldLabel(field: string, t: Translate = english): string {
  const key = `act.field.${field}` as MessageKey;
  return key in en ? t(key) : field.replace(/_id$/, "").replace(/_/g, " ");
}

function describeFinance(entry: AuditLogEntry, ctx: ActivityContext, t: Translate): string | null {
  const row = (entry.diff || {}) as Record<string, unknown>;
  const job = ctx.nameFor("jobs", text(row.job_id));
  const onJob = job ? t("act.onJob", { job }) : "";
  const quoted = (v: unknown) => (text(v) ? ` "${text(v)}"` : "");
  const amountIn = (v: unknown) => (v ? ` (${money(v)})` : "");
  const statusWord = (s: unknown) => text(s).replace(/_/g, " ");

  if (entry.action === "update") {
    const changed = Object.entries(row).filter(([f, v]) => !NOISE_FIELDS.has(f) && isChange(v)) as [string, Change][];
    if (!changed.length) return null;
    const status = changed.find(([f]) => f === "status")?.[1];
    switch (entry.entity) {
      case "project_financials": return t("act.fin.contract");
      case "cost_line_items": return status ? t("act.fin.costStatus", { status: statusWord(status.new) }) : t("act.fin.costUpdated");
      case "change_orders":
        return status
          ? t(text(status.new) === "approved" ? "act.fin.coApproved" : text(status.new) === "rejected" ? "act.fin.coRejected" : "act.fin.coUpdated")
          : t("act.fin.coUpdated");
      case "transactions": return status && text(status.new) === "confirmed" ? t("act.fin.txnConfirmed") : t("act.fin.txnUpdated");
      case "refunds": return status ? t("act.fin.refundStatus", { status: text(status.new) }) : t("act.fin.refundUpdated");
      default: return null;
    }
  }

  const removed = entry.action === "delete";
  switch (entry.entity) {
    case "project_financials": return t(removed ? "act.fin.costingRemoved" : "act.fin.costingSetUp", { onJob });
    case "cost_line_items": return t(removed ? "act.fin.costRemoved" : "act.fin.costAdded", { desc: quoted(row.description), amount: amountIn(row.estimated_cost), onJob });
    case "change_orders": return t(removed ? "act.fin.coRemoved" : "act.fin.coAdded", { desc: quoted(row.description), amount: amountIn(row.amount), onJob });
    case "transactions": {
      const typeKey = `txn.${text(row.transaction_type)}` as MessageKey;
      const label = typeKey in en ? t(typeKey) : t("act.fin.transaction");
      return removed ? t("act.fin.txnRemoved", { label, onJob }) : t("act.fin.txnLogged", { label, amount: money(row.amount), onJob });
    }
    case "refunds": return removed ? t("act.fin.refundRemoved", { onJob }) : t("act.fin.refundTracked", { amount: money(row.amount), onJob });
    case "profit_releases": return removed ? t("act.fin.releaseRemoved", { onJob }) : t("act.fin.released", { amount: money(row.amount), onJob });
    case "drive_files": return removed ? t("act.fin.fileRemoved", { file: quoted(row.file_name) }) : t("act.fin.fileUploaded", { file: quoted(row.file_name) || t("act.fin.aFile") });
    default: return null; // drive_folders are created automatically: not news
  }
}

// null = nothing worth showing (e.g. an update that only touched updated_at).
export function describeActivity(entry: AuditLogEntry, ctx: ActivityContext): string | null {
  const t = ctx.t || english;
  const day = (ymd: string) => formatDay(ymd, undefined, ctx.locale || "en-US");
  if (FINANCE_ENTITIES.has(entry.entity)) return describeFinance(entry, ctx, t);

  const diff = (entry.diff || {}) as Record<string, unknown>;

  // A client's text, written by api/sms-inbound.js.
  if (entry.entity === "messages") {
    return t("act.message", { name: text(diff.name) || t("act.newCustomer"), preview: text(diff.preview) });
  }
  // A booking from the public page writes one booking_requests row for the
  // feed; the client and deal rows it creates would only repeat it.
  if (entry.entity === "booking_requests") {
    const services = Array.isArray(diff.services) ? (diff.services as unknown[]).map(text).filter(Boolean) : [];
    return t("act.booking", {
      name: text(diff.name) || t("act.newCustomer"),
      services: services.length ? ` (${services.join(", ")})` : "",
      existing: diff.existing_client ? t("act.existingClient") : ""
    });
  }
  if (entry.action === "insert" && text(diff.source) === "Booking page" && !entry.user_id) return null;

  const nounKey = ENTITY_NOUN[entry.entity];
  if (!nounKey) {
    // company_access / user_account / user_permissions rows from admin-users.js
    return entry.entity.startsWith("user") || entry.entity === "company_access" ? t("act.userAccess") : null;
  }
  const noun = t(nounKey);

  const rowName = text(diff.name || diff.title).trim();
  const name = ctx.nameFor(entry.entity, entry.entity_id)?.trim() || rowName || t("act.aRecord", { noun });

  if (entry.action === "insert") return t("act.added", { noun, name });
  if (entry.action === "delete") return t("act.deleted", { noun, name: rowName || name });

  const changed = Object.entries(diff).filter(([field, value]) => !NOISE_FIELDS.has(field) && isChange(value)) as [string, Change][];
  if (!changed.length) return null;
  const get = (field: string) => changed.find(([f]) => f === field)?.[1];

  const stage = get("stage_id");
  if (stage) return t("act.moved", { name, stage: ctx.stageName(text(stage.new)) || text(stage.new) });
  const status = get("status");
  if (status && entry.entity === "jobs") {
    const s = text(status.new) || "planned";
    const sKey = `status.${s}` as MessageKey;
    return t("act.markedStatus", { name, status: sKey in en ? t(sKey) : s });
  }
  const scheduled = get("scheduled_date");
  if (scheduled) return scheduled.new ? t("act.scheduled", { name, date: day(text(scheduled.new)) }) : t("act.unscheduled", { name });
  const owner = get("owner_user_id");
  if (owner) return owner.new ? t("act.assigned", { name, user: ctx.userName(text(owner.new)) || t("act.someone") }) : t("act.unassigned", { name });
  const followUp = get("next_action_date");
  if (followUp?.new) return t("act.followUp", { name, date: day(text(followUp.new)) });
  const lostReason = get("lost_reason");
  if (lostReason?.new) return t("act.lost", { name, reason: text(lostReason.new) });
  const drive = get("drive_folder_url");
  if (drive?.new && changed.length === 1) return t("act.driveLinked", { name });

  const fields = changed.map(([f]) => fieldLabel(f, t));
  const listed = fields.length > 2
    ? t("act.fieldsMore", { a: fields[0], b: fields[1], count: fields.length - 2 })
    : fields.length === 2 ? t("act.fieldsTwo", { a: fields[0], b: fields[1] }) : fields[0];
  return t("act.updatedFields", { fields: listed, name });
}
