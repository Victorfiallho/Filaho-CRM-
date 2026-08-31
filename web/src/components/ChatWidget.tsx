import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendChatMessage, type ChatTurn } from "../data/chatAgent";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";

// Global support-style assistant, mounted once in Shell.tsx so it floats
// over every page. Read-only (see web/api/chat-agent.js) and session-only —
// history lives in this component's state and is gone on reload, by design
// (no chat_messages table yet).
export default function ChatWidget() {
  const { activeCompanyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  if (!activeCompanyId) return null;

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !activeCompanyId) return;
    const history = messages;
    setMessages(m => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const reply = await sendChatMessage(activeCompanyId, history, text);
      setMessages(m => [...m, { role: "assistant", text: reply }]);
    } catch (error) {
      toast(errorMessage(error, "Could not reach the assistant."));
      setMessages(m => [...m, { role: "assistant", text: "Sorry, I couldn't respond right now. Please try again in a moment." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel">
          <div className="chat-panel-h">
            <b>Assistant</b>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">
              <X />
            </button>
          </div>
          <div className="chat-panel-body" ref={listRef}>
            {messages.length === 0 && (
              <p className="sub">Ask about your leads, jobs, customers, or campaigns — I'll answer with real data from the active company.</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>{m.text}</div>
            ))}
            {sending && <div className="chat-bubble chat-bubble-assistant chat-bubble-loading">Thinking...</div>}
          </div>
          <div className="chat-panel-input">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask something..."
              disabled={sending}
            />
            <button className="btn slim" onClick={handleSend} disabled={sending || !input.trim()} aria-label="Send message">
              <Send />
            </button>
          </div>
        </section>
      )}
      <button className="chat-fab" onClick={() => setOpen(v => !v)} aria-label="Toggle assistant chat">
        <MessageCircle />
      </button>
    </div>
  );
}
