import { ArrowLeft, Mail, MessageSquare, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import MessageThread from "../components/MessageThread";
import { useCustomers, useRecentMessages } from "../data/hooks";
import { searchClients } from "../domain/deals";
import { formatDateTime } from "../domain/format";
import type { Customer, Message } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { useCompany } from "../state/CompanyContext";

type Conversation = { customer: Customer; last: Message; unread: number };

// Inbox: every client conversation of the company, newest first, unread
// replies on top of mind; the selected one opens on the right.
export default function Messages() {
  const { activeCompanyId } = useCompany();
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
  const unknownInbound = recent.filter(m => m.direction === "in" && !m.customer_id).length;
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const pickResults = picking && q ? searchClients(customers, q).slice(0, 8) : [];

  const open = (id: string) => { setSelectedId(id); setPicking(false); setQuery(""); };

  if (!activeCompanyId) return null;

  return (
    <div className={`inbox${selected ? " has-selection" : ""}`}>
      <section className="card inbox-list">
        <div className="card-b">
          <div className="inbox-tools">
            <label className="inbox-search">
              <Search aria-hidden="true" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={picking ? t("msg.findClient") : t("msg.search")} aria-label={picking ? t("msg.findClient") : t("msg.search")} />
            </label>
            <button className={`btn ${picking ? "" : "ghost "}slim`} type="button" onClick={() => { setPicking(v => !v); setQuery(""); }}>
              <Plus aria-hidden="true" />{t("msg.new")}
            </button>
          </div>

          {picking ? (
            <ul className="inbox-items">
              {!q && <li className="sub inbox-hint">{t("msg.findClientHint")}</li>}
              {pickResults.map(c => (
                <li key={c.id}>
                  <button type="button" className="inbox-item" onClick={() => open(c.id)}>
                    <b>{c.name}</b>
                    <span className="sub">{[c.phone, c.email].filter(Boolean).join(" · ") || t("msg.noContact")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : isLoading ? null : shown.length === 0 ? (
            <EmptyState icon={MessageSquare}>{q ? t("msg.noMatch") : t("msg.noConversations")}</EmptyState>
          ) : (
            <ul className="inbox-items">
              {shown.map(({ customer, last, unread }) => (
                <li key={customer.id}>
                  <button type="button" className={`inbox-item${customer.id === selectedId ? " active" : ""}${unread ? " unread" : ""}`} onClick={() => open(customer.id)}>
                    <span className="inbox-item-top">
                      <b>{customer.name}</b>
                      <span className="sub">{formatDateTime(last.created_at, locale)}</span>
                    </span>
                    <span className="inbox-item-preview">
                      {last.channel === "sms" ? <MessageSquare aria-hidden="true" /> : <Mail aria-hidden="true" />}
                      <span>{last.direction === "out" ? `${t("msg.you")}: ` : ""}{last.body}</span>
                      {unread > 0 && <span className="inbox-badge" aria-label={t("msg.unread", { count: unread })}>{unread}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unknownInbound > 0 && <p className="sub inbox-hint">{t("msg.unknownSenders", { count: unknownInbound })}</p>}
        </div>
      </section>

      <section className="card inbox-thread">
        {selected ? (
          <>
            <div className="card-h">
              <button className="round-btn inbox-back" type="button" onClick={() => setSelectedId(null)} aria-label={t("msg.back")}><ArrowLeft aria-hidden="true" /></button>
              <div>
                <h3>{selected.name}</h3>
                <span className="sub">{[selected.phone, selected.email].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
            <div className="card-b">
              <MessageThread key={selected.id} companyId={activeCompanyId} customer={selected} />
            </div>
          </>
        ) : (
          <div className="card-b"><EmptyState icon={MessageSquare}>{t("msg.pick")}</EmptyState></div>
        )}
      </section>
    </div>
  );
}
