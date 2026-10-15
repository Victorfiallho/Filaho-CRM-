import { ArrowUp, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { sendChatMessage, type ChatTurn } from "../data/chatAgent";
import { useCustomers, useJobs, useLeads } from "../data/hooks";
import type { MessageKey } from "../i18n/messages";
import { parseMarkdown, type Inline } from "../lib/chatMarkdown";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";
import { useT } from "../i18n/I18nContext";

// The assistant, mounted once in Shell so it floats over every page.
// Read-only (web/api/chat-agent.js). The conversation is kept per company
// for the browser session, so it survives page changes but not closing the
// tab. Also opened from the account menu (openAssistant()), since phones
// hide the floating button.
const OPEN_EVENT = "fialho:open-assistant";
export function openAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const SUGGESTIONS: MessageKey[] = ["chat.suggest.today", "chat.suggest.multiDeals", "chat.suggest.overdue", "chat.suggest.funnel"];
const storageKey = (companyId: string) => `fialho_chat_${companyId}`;

function loadHistory(companyId: string): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(storageKey(companyId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(t => t && typeof t.text === "string" && (t.role === "user" || t.role === "assistant")) : [];
  } catch {
    return [];
  }
}

export default function ChatWidget() {
  const { activeCompanyId } = useCompany();
  return activeCompanyId ? <ChatPanel key={activeCompanyId} companyId={activeCompanyId} /> : null;
}

function ChatPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>(() => loadHistory(companyId));
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey(companyId), JSON.stringify(messages.slice(-30))); } catch { /* storage unavailable */ }
  }, [companyId, messages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, sending]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    const history = messages;
    setMessages(m => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const reply = await sendChatMessage(companyId, history, text, lang);
      setMessages(m => [...m, { role: "assistant", text: reply }]);
    } catch (error) {
      toastError(errorMessage(error, t("chat.error")));
      setMessages(m => [...m, { role: "assistant", text: t("chat.sorry") }]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-label={t("chat.title")}>
          <div className="chat-panel-h">
            <span className="chat-avatar" aria-hidden="true"><Sparkles /></span>
            <div className="chat-panel-title">
              <b>{t("chat.title")}</b>
              <span className="sub">{t("chat.subtitle")}</span>
            </div>
            {messages.length > 0 && (
              <button className="round-btn small" onClick={() => setMessages([])} aria-label={t("chat.reset")} title={t("chat.reset")} disabled={sending}>
                <RotateCcw aria-hidden="true" />
              </button>
            )}
            <button className="round-btn small" onClick={() => setOpen(false)} aria-label={t("chat.close")}>
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="chat-panel-body" ref={listRef} aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>{t("chat.intro")}</p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map(key => (
                    <button key={key} type="button" className="chat-chip" onClick={() => send(t(key))}>{t(key)}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg chat-msg-${m.role}`}>
                {m.role === "assistant" ? <Rich text={m.text} onOpen={() => setOpen(false)} /> : m.text}
              </div>
            ))}
            {sending && (
              <div className="chat-msg chat-msg-assistant chat-typing" aria-label={t("chat.thinking")}>
                <span /><span /><span />
              </div>
            )}
          </div>

          <form className="chat-panel-input" onSubmit={e => { e.preventDefault(); send(); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              maxLength={2000}
            />
            <button className="chat-send" type="submit" disabled={sending || !input.trim()} aria-label={t("chat.send")}>
              <ArrowUp aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
      <button className="chat-fab" onClick={() => setOpen(v => !v)} aria-label={t("chat.open")} aria-expanded={open}>
        {open ? <X /> : <MessageCircle />}
      </button>
    </div>
  );
}

// An assistant reply: parsed Markdown whose record links open the record.
function Rich({ text, onOpen }: { text: string; onOpen: () => void }) {
  const { activeCompanyId } = useCompany();
  const { openRecordModal } = useModal();
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);

  const inline = (parts: Inline[]): ReactNode => parts.map((p, i) => {
    if (p.kind === "bold") return <b key={i}>{p.text}</b>;
    if (p.kind === "code") return <code key={i}>{p.text}</code>;
    if (p.kind === "record") {
      const record = p.type === "lead" ? leads.find(l => l.id === p.id) : p.type === "customer" ? customers.find(c => c.id === p.id) : jobs.find(j => j.id === p.id);
      if (!record) return <Fragment key={i}>{p.text}</Fragment>;
      return (
        <button key={i} type="button" className={`chat-ref chat-ref-${p.type}`} onClick={() => { openRecordModal(p.type, record); onOpen(); }}>
          {p.text}
        </button>
      );
    }
    return <Fragment key={i}>{p.text}</Fragment>;
  });

  return (
    <>
      {parseMarkdown(text).map((block, i) => {
        if (block.kind === "p") return <p key={i}>{block.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{inline(line)}</Fragment>)}</p>;
        const List = block.kind;
        return <List key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</List>;
      })}
    </>
  );
}
