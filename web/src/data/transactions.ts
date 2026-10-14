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

// created_by defaults to auth.uid(); approved_by is set only by
// confirmTransaction().
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

// Confirmed transactions are never edited or deleted (a DB trigger blocks
// it). A correction is a new opposite entry pointing at the original.
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
