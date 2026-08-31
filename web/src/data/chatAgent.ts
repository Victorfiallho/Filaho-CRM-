import { supabase } from "../lib/supabaseClient";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

// Calls web/api/chat-agent.js — a read-only support assistant scoped to
// `companyId` server-side (see that file's SECURITY MODEL comment). History
// is plain text turns only, kept client-side in memory (ChatWidget.tsx),
// never persisted.
export async function sendChatMessage(companyId: string, history: ChatTurn[], message: string): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");
  const res = await fetch("/api/chat-agent", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ company_id: companyId, history, message })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to reach the assistant.");
  const data = await res.json();
  return data.reply as string;
}
