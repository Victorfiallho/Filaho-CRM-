import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFinanceSettings, usePermissions, useQuotes } from "../data/hooks";
import { createQuote } from "../data/quotes";
import { formatDay, money } from "../domain/format";
import type { Lead } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useModal } from "../state/ModalContext";

// The deal's quotes, newest version first, inside the deal form.
export default function DealQuotes({ lead }: { lead: Lead }) {
  const { activeCompanyId } = useCompany();
  const { t, locale } = useT();
  const { closeModal } = useModal();
  const { has } = usePermissions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: quotes = [], isLoading } = useQuotes(activeCompanyId, lead.id);
  const { data: settings } = useFinanceSettings(activeCompanyId);
  const [creating, setCreating] = useState(false);

  const open = (id: string) => { closeModal(); navigate(`/pipeline/quotes/${id}`); };

  async function create() {
    if (!activeCompanyId) return;
    setCreating(true);
    try {
      const id = await createQuote(activeCompanyId, lead, {
        pricing_pct: Number(settings?.default_minimum_margin_pct ?? 35),
        deposit_pct: Number(settings?.default_deposit_pct ?? 0)
      });
      queryClient.invalidateQueries({ queryKey: ["quotes", activeCompanyId, lead.id] });
      open(id);
    } catch (error) {
      toastError(errorMessage(error, t("quote.createError")));
      setCreating(false);
    }
  }

  return (
    <>
      {isLoading ? null : quotes.length === 0 ? (
        <p className="sub">{t("quote.none")}</p>
      ) : (
        <ul className="deal-list">
          {quotes.map(q => (
            <li key={q.id}>
              <button type="button" className="deal-row" onClick={() => open(q.id)}>
                <FileText className="deal-icon" aria-hidden="true" />
                <span className="deal-main">
                  <b>{t("quote.versionN", { version: q.version })}{q.title ? ` · ${q.title}` : ""}</b>
                  <span className="sub">
                    {q.status === "sent" && q.sent_at
                      ? t("quote.sentOn", { date: formatDay(q.sent_at, undefined, locale) })
                      : t("quote.draftOn", { date: formatDay(q.updated_at, undefined, locale) })}
                  </span>
                </span>
                <span className={`pill status-${q.status === "sent" ? "approved" : "draft"}`}>{t(q.status === "sent" ? "quote.status.sent" : "quote.status.draft")}</span>
                {Number(q.total) > 0 && <span className="deal-value">{money(Number(q.total))}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {has("create") && (
        <button type="button" className="btn ghost slim" onClick={create} disabled={creating}>
          <Plus aria-hidden="true" />{creating ? t("quote.creating") : quotes.length ? t("quote.newVersion") : t("quote.new")}
        </button>
      )}
    </>
  );
}
