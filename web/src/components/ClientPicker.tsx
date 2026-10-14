import { Pencil, Plus, Search, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { searchClients } from "../domain/deals";
import type { Customer } from "../domain/types";
import { useT } from "../i18n/I18nContext";

// "Who is this deal for?": search the company's clients by name, phone or
// email, or start a new one with what was typed. With a client picked it
// shows them, with Change and Edit client.
export default function ClientPicker({ customers, value, onPick, onNew, onEdit }: {
  customers: Customer[];
  value: string;
  onPick: (clientId: string) => void;
  onNew: (typed: string) => void;
  onEdit?: (client: Customer) => void;
}) {
  const { t } = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const picked = customers.find(c => c.id === value);

  if (picked) {
    const contact = [picked.phone, picked.email].filter(Boolean).join(" · ");
    const place = [picked.address, picked.city, picked.state, picked.zip].filter(Boolean).join(", ");
    return (
      <div className="client-card">
        <span className="client-card-icon" aria-hidden="true"><UserRound /></span>
        <div className="client-card-main">
          <b>{picked.name}</b>
          {contact && <span className="sub">{contact}</span>}
          {place && <span className="sub">{place}</span>}
        </div>
        <div className="client-card-actions">
          {onEdit && <button type="button" className="btn ghost slim" onClick={() => onEdit(picked)}><Pencil aria-hidden="true" />{t("deal.editClient")}</button>}
          <button type="button" className="btn ghost slim" onClick={() => { setQuery(""); onPick(""); }}>{t("deal.changeClient")}</button>
        </div>
      </div>
    );
  }

  const matches = query.trim() ? searchClients(customers, query, 8) : [];
  return (
    <div className="client-picker">
      <label htmlFor={id} className="field-label">{t("deal.whoFor")}</label>
      <div className="client-search">
        <Search aria-hidden="true" />
        <input
          id={id}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t("deal.searchClient")}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
        />
      </div>
      <span id={`${id}-hint`} className="sub">{query.trim() && !matches.length ? t("deal.noClientFound") : t("deal.searchHint")}</span>
      {matches.length > 0 && (
        <ul className="client-results" aria-label={t("deal.results")}>
          {matches.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)}>
                <b>{c.name}</b>
                <span className="sub">{[c.phone, c.email, c.city].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn ghost slim client-new" onClick={() => onNew(query)}>
        <Plus aria-hidden="true" />{query.trim() ? t("deal.newClientNamed", { name: query.trim() }) : t("deal.newClient")}
      </button>
    </div>
  );
}
