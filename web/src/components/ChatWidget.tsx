import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendChatMessage, type ChatTurn } from "../data/chatAgent";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useT } from "../i18n/I18nContext";

// Global support-style assistant, mounted once in Shell.tsx so it floats
// over every page. Read-only (see web/api/chat-agent.js) and session-only —
// history lives in this component's state and is gone on reload, by design
// (no chat_messages table yet).
//
// Also opened from the account menu (openAssistant()): on phones the
// floating button is hidden because it covered page content.
const OPEN_EVENT = "fialho:open-assistant";
export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export default function ChatWidget() {
  const { activeCompanyId } = useCompany();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

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
      toastError(errorMessage(error, t("chat.error")));
      setMessages(m => [...m, { role: "assistant", text: t("chat.sorry") }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel">
          <div className="chat-panel-h">
            <b>{t("chat.title")}</b>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t("chat.close")}>
              <X />
            </button>
          </div>
          <div className="chat-panel-body" ref={listRef}>
            {messages.length === 0 && (
              <p className="sub">{t("chat.intro")}</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>{m.text}</div>
            ))}
            {sending && <div className="chat-bubble chat-bubble-assistant chat-bubble-loading">{t("chat.thinking")}</div>}
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
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              disabled={sending}
            />
            <button className="btn slim" onClick={handleSend} disabled={sending || !input.trim()} aria-label={t("chat.send")}>
              <Send />
            </button>
          </div>
        </section>
      )}
      <button className="chat-fab" onClick={() => setOpen(v => !v)} aria-label={t("chat.open")} aria-expanded={open}>
        <MessageCircle />
      </button>
    </div>
  );
}
