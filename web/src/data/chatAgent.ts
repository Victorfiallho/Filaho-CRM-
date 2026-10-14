import { apiFetch } from "../lib/apiFetch";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

// Calls web/api/chat-agent.js (read-only, scoped to `companyId` server-side).
// History is plain text turns kept by ChatWidget.tsx. `lang` is the app
// language, so the assistant answers in it.
export async function sendChatMessage(companyId: string, history: ChatTurn[], message: string, lang: string): Promise<string> {
  const data = await apiFetch<{ reply: string }>("/api/chat-agent", { company_id: companyId, history, message, lang }, "Failed to reach the assistant.");
  return data.reply;
}
