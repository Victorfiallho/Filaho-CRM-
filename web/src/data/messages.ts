import type { Message, MessageChannel } from "../domain/types";
import { apiFetch } from "../lib/apiFetch";
import { supabase } from "../lib/supabaseClient";

export async function listThread(companyId: string, customerId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data || []) as Message[];
}

// Latest messages of the company, newest first; the inbox groups them by
// client.
export async function listRecentMessages(companyId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []) as Message[];
}

export async function getMessagingStatus(companyId: string): Promise<{ sms: boolean; email: boolean }> {
  return apiFetch(`/api/messages?company_id=${encodeURIComponent(companyId)}`, undefined, "Could not check messaging setup.");
}

export async function sendMessage(input: { companyId: string; customerId: string; channel: MessageChannel; subject?: string; body: string }): Promise<Message> {
  const result = await apiFetch<{ message: Message }>("/api/messages", {
    company_id: input.companyId,
    customer_id: input.customerId,
    channel: input.channel,
    subject: input.subject || "",
    body: input.body
  }, "Could not send the message.");
  return result.message;
}

export async function markThreadRead(companyId: string, customerId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_messages_read", { p_company_id: companyId, p_customer_id: customerId });
  if (error) throw error;
}
