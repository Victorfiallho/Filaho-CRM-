import { ArrowLeft, Mail, MessageSquare, Phone, Plus, Search, SquareArrowOutUpRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import MessageThread from "../components/MessageThread";
import { useCustomers, useRecentMessages } from "../data/hooks";
import { searchClients } from "../domain/deals";
import { avatarTone, initials, listTime } from "../domain/messages";
import type { Customer, Message } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

type Conversation = { customer: Customer; last: Message; unread: number };

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return <span className={`avatar avatar-${size} tone-${avatarTone(name)}`} aria-hidden="true">{initials(name)}</span>;
}

// Inbox: every client conversation of the company, newest first, with
// unread replies marked; the selected one opens on the right.
export default function Messages() {
  const { activeCompanyId } = useCompany();
  const { openRecordModal } = useModal();
  const { t, locale } = useT();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: recent = [], isLoading } = useRecentMessages(activeCompanyId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);

  const byId = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const conversations = useMemo(() => {
    const out = new Map<string, Conversation>();
    for (const m of recent) {
      const customer = m.customer_id ? byId.get(m.customer_id) : undefined;
      if (!customer) continue;
      const c = out.get(customer.id) || { customer, last: m, unread: 0 };
      if (m.direction === "in" && !m.read_at) c.unread++;
      out.set(customer.id, c);
    }
    return [...out.values()];
  }, [recent, byId]);

  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter(c => `${c.customer.name} ${c.customer.phone} ${c.customer.email}`.toLowerCase().includes(q)) : conversations;
  const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0);
  const unknownInbound = recent.filter(m => m.direction === "in" && !m.customer_id).length;
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const pickResults = picking && q ? searchClients(customers, q).slice(0, 8) : [];

  const open = (id: string) => { setSelectedId(id); setPicking(false); setQuery(""); };
  const togglePicking = () => { setPicking(v => !v); setQuery(""); };

  if (!activeCompanyId) return null;

  return (
    <div className={`inbox${selected ? " has-selection" : ""}`}>
      <section className="card inbox-list">
        <div className="inbox-list-head">
          <div className="inbox-title">
            <h3>{picking ? t("msg.newTitle") : t("msg.conversations")}</h3>
            {!picking && unreadTotal > 0 && <span className="inbox-badge">{unreadTotal}</span>}
          </div>
          <button className={`btn slim${picking ? " ghost" : ""}`} type="button" onClick={togglePicking}>
            {picking ? <><X aria-hidden="true" />{t("msg.cancel")}</> : <><Plus aria-hidden="true" />{t("msg.new")}</>}
          </button>
        </div>
        <label className="inbox-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={picking ? t("msg.findClient") : t("msg.search")} aria-label={picking ? t("msg.findClient") : t("msg.search")} autoFocus={picking} />
        </label>

        {picking ? (
          <ul className="inbox-items">
            {!q && <li className="inbox-hint">{t("msg.findClientHint")}</li>}
            {q && pickResults.length === 0 && <li className="inbox-hint">{t("msg.noClientMatch")}</li>}
            {pickResults.map(c => (
              <li key={c.id}>
                <button type="button" className="inbox-item" onClick={() => open(c.id)}>
                  <Avatar name={c.name} />
                  <span className="inbox-item-main">
                    <b className="inbox-name">{c.name}</b>
                    <span className="inbox-preview">{[c.phone, c.email].filter(Boolean).join(" · ") || t("msg.noContact")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : isLoading ? null : shown.length === 0 ? (
          <div className="inbox-empty"><EmptyState icon={MessageSquare}>{q ? t("msg.noMatch") : t("msg.noConversations")}</EmptyState></div>
        ) : (
          <ul className="inbox-items">
            {shown.map(({ customer, last, unread }) => (
              <li key={customer.id}>
                <button type="button" className={`inbox-item${customer.id === selectedId ? " active" : ""}${unread ? " unread" : ""}`} onClick={() => open(customer.id)}>
                  <Avatar name={customer.name} />
                  <span className="inbox-item-main">
                    <span className="inbox-item-top">
                      <b className="inbox-name">{customer.name}</b>
                      <span className="inbox-time">{listTime(last.created_at, locale, t("msg.yesterday"))}</span>
                    </span>
                    <span className="inbox-item-bottom">
                      <span className="inbox-preview">
                        {last.channel === "sms" ? <MessageSquare aria-hidden="true" /> : <Mail aria-hidden="true" />}
                        <span>{last.direction === "out" ? `${t("msg.you")}: ` : ""}{last.body}</span>
                      </span>
                      {unread > 0 && <span className="inbox-badge" aria-label={t("msg.unread", { count: unread })}>{unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!picking && unknownInbound > 0 && <p className="inbox-hint">{t("msg.unknownSenders", { count: unknownInbound })}</p>}
      </section>

      <section className="card inbox-thread">
        {selected ? (
          <>
            <header className="inbox-thread-head">
              <button className="round-btn inbox-back" type="button" onClick={() => setSelectedId(null)} aria-label={t("msg.back")}><ArrowLeft aria-hidden="true" /></button>
              <Avatar name={selected.name} size="lg" />
              <div className="inbox-thread-who">
                <h3>{selected.name}</h3>
                <div className="inbox-chips">
                  {selected.phone && <span className="inbox-chip"><Phone aria-hidden="true" />{selected.phone}</span>}
                  {selected.email && <span className="inbox-chip"><Mail aria-hidden="true" />{selected.email}</span>}
                </div>
              </div>
              <button className="btn ghost slim inbox-open" type="button" onClick={() => openRecordModal("customer", selected)}>
                <SquareArrowOutUpRight aria-hidden="true" /><span>{t("msg.openRecord")}</span>
              </button>
            </header>
            <MessageThread key={selected.id} companyId={activeCompanyId} customer={selected} fill />
          </>
        ) : (
          <div className="inbox-placeholder">
            <span className="msg-empty-icon" aria-hidden="true"><MessageSquare /></span>
            <p>{t("msg.pick")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
