// Turns audit_log rows (written by the record_audit_log() trigger and by
// web/api/admin-users.js) into one plain sentence each for the Dashboard's
// activity feed — "moved Jane Doe to Won" instead of "Lead updated: Jane Doe".
// The trigger stores an UPDATE as {field: {old, new}} for changed columns
// only, and an INSERT/DELETE as the full row.
import { formatDay, money } from "./format";
import { TRANSACTION_TYPE_LABELS } from "./transactions";
import type { AuditLogEntry, TransactionType } from "./types";

// Bookkeeping that changes on its own (every save, every calendar sync,
// every geocode) — an update that touched only these isn't news.
const NOISE_FIELDS = new Set(["updated_at", "lat", "lng", "google_event_id", "source_uid"]);

const ENTITY_NOUN: Record<string, string> = {
  customers: "client",
  leads: "lead",
  jobs: "job",
  pipeline_stages: "pipeline stage"
};

// Project money tables — shown in the feed to owners only, matching who can
// open the finance screens.
const FINANCE_ENTITIES = new Set(["project_financials", "change_orders", "cost_line_items", "transactions", "refunds", "profit_releases", "drive_files", "drive_folders"]);

export function isFinanceActivity(entry: AuditLogEntry): boolean {
  return FINANCE_ENTITIES.has(entry.entity);
}

export interface ActivityContext {
  // Current name of a record that still exists (an UPDATE diff carries only
  // the changed columns, so the name usually isn't in it).
  nameFor: (entity: string, id: string) => string | undefined;
  stageName: (stageId: string) => string | undefined;
  userName: (appUserId: string) => string | undefined;
}

type Change = { old: unknown; new: unknown };

function isChange(value: unknown): value is Change {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "old" in (value as object) && "new" in (value as object);
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function describeFinance(entry: AuditLogEntry, ctx: ActivityContext): string | null {
  const row = (entry.diff || {}) as Record<string, unknown>;
  const job = ctx.nameFor("jobs", text(row.job_id));
  const onJob = job ? ` on ${job}` : "";
  const quoted = (v: unknown) => (text(v) ? ` "${text(v)}"` : "");

  if (entry.action === "update") {
    const changed = Object.entries(row).filter(([f, v]) => !NOISE_FIELDS.has(f) && isChange(v)) as [string, Change][];
    if (!changed.length) return null;
    const status = changed.find(([f]) => f === "status")?.[1];
    switch (entry.entity) {
      case "project_financials": return "updated a project's contract terms";
      case "cost_line_items": return status ? `marked a cost item as ${text(status.new).replace(/_/g, " ")}` : "updated a cost item";
      case "change_orders": return status ? `${text(status.new) === "approved" ? "approved" : text(status.new) === "rejected" ? "rejected" : "updated"} a change order` : "updated a change order";
      case "transactions": return status && text(status.new) === "confirmed" ? "confirmed a transaction" : "updated a transaction";
      case "refunds": return status ? `marked a refund as ${text(status.new)}` : "updated a refund";
      default: return null;
    }
  }

  const verb = entry.action === "delete" ? "removed" : null;
  switch (entry.entity) {
    case "project_financials": return verb ? `removed costing${onJob}` : `set up costing${onJob}`;
    case "cost_line_items": return `${verb || "added"} cost${quoted(row.description)}${row.estimated_cost ? ` (${money(row.estimated_cost)})` : ""}${onJob}`;
    case "change_orders": return `${verb || "added"} change order${quoted(row.description)}${row.amount ? ` (${money(row.amount)})` : ""}${onJob}`;
    case "transactions": {
      const label = TRANSACTION_TYPE_LABELS[text(row.transaction_type) as TransactionType]?.toLowerCase() || "transaction";
      return verb ? `removed a draft ${label}${onJob}` : `logged a ${label} of ${money(row.amount)}${onJob}`;
    }
    case "refunds": return verb ? `removed a refund${onJob}` : `tracked a ${money(row.amount)} refund${onJob}`;
    case "profit_releases": return verb ? `removed a profit release${onJob}` : `released ${money(row.amount)} profit${onJob}`;
    case "drive_files": return verb ? `removed file${quoted(row.file_name)}` : `uploaded${quoted(row.file_name) || " a file"} to Drive`;
    default: return null; // drive_folders: created automatically, not news
  }
}

// null = nothing worth showing (e.g. an update that only touched updated_at).
export function describeActivity(entry: AuditLogEntry, ctx: ActivityContext): string | null {
  if (FINANCE_ENTITIES.has(entry.entity)) return describeFinance(entry, ctx);

  const diff = entry.diff || {};
  const noun = ENTITY_NOUN[entry.entity];

  if (!noun) {
    // company_access / user_account / user_permissions rows from admin-users.js
    return entry.entity.startsWith("user") || entry.entity === "company_access" ? "changed user access settings" : null;
  }

  const rowName = text((diff as Record<string, unknown>).name || (diff as Record<string, unknown>).title).trim();
  const name = ctx.nameFor(entry.entity, entry.entity_id)?.trim() || rowName || `a ${noun}`;

  if (entry.action === "insert") return `added ${noun} ${name}`;
  if (entry.action === "delete") return `deleted ${noun} ${rowName || name}`;

  const changed = Object.entries(diff).filter(([field, value]) => !NOISE_FIELDS.has(field) && isChange(value)) as [string, Change][];
  if (!changed.length) return null;
  const get = (field: string) => changed.find(([f]) => f === field)?.[1];

  const stage = get("stage_id");
  if (stage) return `moved ${name} to ${ctx.stageName(text(stage.new)) || text(stage.new)}`;
  const status = get("status");
  if (status && entry.entity === "jobs") return `marked ${name} as ${text(status.new) || "planned"}`;
  const scheduled = get("scheduled_date");
  if (scheduled) return scheduled.new ? `scheduled ${name} for ${formatDay(text(scheduled.new))}` : `unscheduled ${name}`;
  const owner = get("owner_user_id");
  if (owner) return owner.new ? `assigned ${name} to ${ctx.userName(text(owner.new)) || "someone"}` : `unassigned ${name}`;
  const followUp = get("next_action_date");
  if (followUp?.new) return `set a follow-up on ${name} for ${formatDay(text(followUp.new))}`;
  const lostReason = get("lost_reason");
  if (lostReason?.new) return `marked ${name} as lost: ${text(lostReason.new)}`;
  const drive = get("drive_folder_url");
  if (drive?.new && changed.length === 1) return `linked a Drive folder to ${name}`;

  const fields = changed.map(([f]) => f.replace(/_id$/, "").replace(/_/g, " "));
  const listed = fields.slice(0, 2).join(" and ") + (fields.length > 2 ? ` and ${fields.length - 2} more` : "");
  return `updated ${listed} on ${name}`;
}
