import { supabase } from "../lib/supabaseClient";
import { now, uid } from "../domain/format";
import { toDateOrNull } from "../lib/numeric";
import type { Transaction } from "../domain/types";

export async function listTransactionsByJob(jobId: string): Promise<Transaction[]> {
  const { data, error } = await supabase.from("transactions").select("*").eq("job_id", jobId).order("transaction_date", { ascending: false });
  if (error) throw error;
  return (data || []) as Transaction[];
}

export async function listTransactionsByCompany(companyId: string): Promise<Transaction[]> {
  const { data, error } = await supabase.from("transactions").select("*").eq("company_id", companyId).order("transaction_date", { ascending: false });
  if (error) throw error;
  return (data || []) as Transaction[];
}

// created_by/approved_by are intentionally not accepted here — created_by
// defaults to auth.uid() at the DB level, approved_by is only ever set by
// confirmTransaction() below.
export async function insertTransaction(row: Omit<Transaction, "id" | "status" | "created_by" | "approved_by" | "created_at" | "updated_at" | "reversal_of"> & { id?: string }): Promise<Transaction> {
  const record = {
    id: row.id || uid("txn"),
    status: "draft",
    reversal_of: null,
    created_at: now(),
    ...row,
    due_date: toDateOrNull(row.due_date),
    transaction_date: row.transaction_date || now().slice(0, 10)
  };
  const { data, error } = await supabase.from("transactions").insert(record).select().single();
  if (error) throw error;
  return data as Transaction;
}

// Only draft rows may be freely edited — the DB trigger enforces this for
// confirmed rows regardless, but checking here gives a clearer error message
// than a raw Postgres exception in the UI.
export async function updateDraftTransaction(id: string, companyId: string, patch: Partial<Transaction>): Promise<Transaction> {
  const sanitized = { ...patch, updated_at: now() } as Record<string, unknown>;
  if ("due_date" in patch) sanitized.due_date = toDateOrNull(patch.due_date);
  const { data, error } = await supabase.from("transactions").update(sanitized).eq("id", id).eq("company_id", companyId).eq("status", "draft").select().single();
  if (error) throw error;
  return data as Transaction;
}

export async function deleteDraftTransaction(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from("transactions").delete().eq("id", id).eq("company_id", companyId).eq("status", "draft");
  if (error) throw error;
}

export async function confirmTransaction(id: string, companyId: string, approvedByUserId: string | null): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .update({ status: "confirmed", approved_by: approvedByUserId, updated_at: now() })
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("status", "draft")
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

// A confirmed transaction is never edited or deleted (DB trigger blocks it)
// — correcting one means posting a new, opposite-purpose entry that
// references it, keeping the original in the audit trail per spec section 6.
export async function reverseTransaction(original: Transaction, reason: string): Promise<Transaction> {
  const record = {
    id: uid("txn"),
    company_id: original.company_id,
    client_id: original.client_id,
    job_id: original.job_id,
    transaction_type: "adjustment" as const,
    category: original.category,
    vendor_id: original.vendor_id,
    payee_name: original.payee_name,
    description: `Reversal of ${original.id}: ${reason}`,
    transaction_date: now().slice(0, 10),
    due_date: null,
    amount: original.amount,
    sales_tax: original.sales_tax,
    payment_method: original.payment_method,
    account: original.account,
    receipt_id: null,
    reversal_of: original.id,
    status: "draft",
    created_at: now()
  };
  const { data, error } = await supabase.from("transactions").insert(record).select().single();
  if (error) throw error;
  return data as Transaction;
}
