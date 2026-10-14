import { useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import KpiStrip from "../components/KpiStrip";
import PageSkeleton from "../components/PageSkeleton";
import SearchField from "../components/SearchField";
import { useAllQuotes, useCustomers, useFinanceSettings, useLeads, usePermissions } from "../data/hooks";
import { createQuote, type Quote } from "../data/quotes";
import { dealTitle } from "../domain/deals";
import { money, relativeDate } from "../domain/format";
import { isLostStage, isOpenStage } from "../domain/pipelineStages";
import { latestQuotePerDeal } from "../domain/quotes";
import { filterRowsBySearch } from "../domain/search";
import type { Lead } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { errorMessage } from "../lib/errorMessage";
import { toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useSearch } from "../state/SearchContext";

type Filter = "all" | "draft" | "sent";

// Every deal's latest quote, plus a way to start one without going through
// the pipeline. Older versions stay reachable from the deal.
export default function Quotes() {
  const { activeCompanyId, stages } = useCompany();
  const { t, locale } = useT();
  const { has } = usePermissions();
  const { searchText } = useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: quotes = [], isLoading } = useAllQuotes(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useFinanceSettings(activeCompanyId);
  const [filter, setFilter] = useState<Filter>("all");
  const [picking, setPicking] = useState(false);
  const [dealQuery, setDealQuery] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  if (!activeCompanyId || isLoading || leadsLoading) return <PageSkeleton rows={[3, 8]} />;

  const leadById = new Map(leads.map(l => [l.id, l]));
  const clientName = (q: Quote) => {
    const lead = q.lead_id ? leadById.get(q.lead_id) : undefined;
    return customers.find(c => c.id === (q.customer_id || lead?.customer_id))?.name || lead?.name || "";
  };
  const latest = latestQuotePerDeal(quotes);
  const versions = new Map<string, number>();
  for (const q of quotes) if (q.lead_id) versions.set(q.lead_id, (versions.get(q.lead_id) || 0) + 1);

  const rows = latest.map(q => {
    const lead = q.lead_id ? leadById.get(q.lead_id) : undefined;
    return { ...q, name: clientName(q), deal: lead ? dealTitle(lead) : "", service_type: lead?.service_type || "", lead };
  });
  const visible = filterRowsBySearch(rows.filter(r => filter === "all" || r.status === filter), searchText);

  const drafts = latest.filter(q => q.status === "draft");
  const sentOpen = latest.filter(q => q.status === "sent" && q.lead_id && isOpenStage(leadById.get(q.lead_id)?.stage_id || "", stages));

  // Deals that can get a quote: open first, then won; lost ones are left out.
  const quotable = leads
    .filter(l => !isLostStage(l.stage_id, stages))
    .sort((a, b) => Number(isOpenStage(b.stage_id, stages)) - Number(isOpenStage(a.stage_id, stages)) || b.updated_at.localeCompare(a.updated_at));
  const dealMatches = filterRowsBySearch(quotable, dealQuery).slice(0, 8);

  async function startFor(lead: Lead) {
    if (!activeCompanyId) return;
    setCreating(lead.id);
    try {
      const id = await createQuote(activeCompanyId, lead, {
        pricing_pct: Number(settings?.default_minimum_margin_pct ?? 35),
        deposit_pct: Number(settings?.default_deposit_pct ?? 0)
      });
      queryClient.invalidateQueries({ queryKey: ["quotes", activeCompanyId] });
      navigate(`/quotes/${id}`);
    } catch (error) {
      toastError(errorMessage(error, t("quote.createError")));
      setCreating(null);
    }
  }

  return (
    <div className="quotes-page">
      <KpiStrip items={[
        { label: t("quotes.kpi.drafts"), value: drafts.length, hint: money(drafts.reduce((s, q) => s + Number(q.total || 0), 0)), tone: "amber" },
        { label: t("quotes.kpi.awaiting"), value: sentOpen.length, hint: t("quotes.kpi.awaitingHint", { value: money(sentOpen.reduce((s, q) => s + Number(q.total || 0), 0)) }), tone: "blue" },
        { label: t("quotes.kpi.total"), value: latest.length, hint: t("quotes.kpi.totalHint", { count: quotes.length }), tone: "purple" }
      ]} />

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h quotes-toolbar">
          <div className="pf-tabs quotes-tabs" role="tablist" aria-label={t("quotes.filter")}>
            {(["all", "draft", "sent"] as const).map(f => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {t(`quotes.filter.${f}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="inline-actions">
            <SearchField placeholder={t("quotes.search")} />
            {has("create") && (
              <button className="btn slim" onClick={() => setPicking(p => !p)} aria-expanded={picking}>
                {picking ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{t("quote.new")}
              </button>
            )}
          </div>
        </div>

        {picking && (
          <div className="card-b quotes-picker">
            <span className="field-label">{t("quotes.pickDeal")}</span>
            <input
              type="search"
              autoFocus
              value={dealQuery}
              onChange={e => setDealQuery(e.target.value)}
              placeholder={t("quotes.pickDealPlaceholder")}
              aria-label={t("quotes.pickDeal")}
            />
            {dealMatches.length === 0 ? (
              <p className="sub">{t("quotes.noDeals")}</p>
            ) : (
              <ul className="deal-list">
                {dealMatches.map(l => {
                  const stage = stages.find(s => s.id === l.stage_id);
                  const count = versions.get(l.id) || 0;
                  return (
                    <li key={l.id}>
                      <button type="button" className="deal-row" onClick={() => startFor(l)} disabled={creating !== null}>
                        <span className="deal-dot" style={{ background: stage?.color || "var(--muted-soft)" }} aria-hidden="true" />
                        <span className="deal-main">
                          <b>{l.name}</b>
                          <span className="sub">{[dealTitle(l), stage?.name].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="sub">{creating === l.id ? t("quote.creating") : count ? t("quotes.hasVersions", { count }) : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="card-b">
          {visible.length === 0 ? (
            <EmptyState icon={FileText}>{quotes.length ? t("quotes.noMatch") : t("quotes.empty")}</EmptyState>
          ) : (
            <ul className="deal-list quotes-list">
              {visible.map(q => (
                <li key={q.id}>
                  <button type="button" className="deal-row quote-row" onClick={() => navigate(`/quotes/${q.id}`)}>
                    <FileText className="deal-icon" aria-hidden="true" />
                    <span className="deal-main">
                      <b>{q.name || t("quote.deal")}</b>
                      <span className="sub">
                        {[q.title || q.deal, t("quote.versionShort", { version: q.version }), (versions.get(q.lead_id || "") || 0) > 1 ? t("quotes.hasVersions", { count: versions.get(q.lead_id || "") || 0 }) : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="quote-row-meta">
                      <span className={`pill status-${q.status === "sent" ? "approved" : "draft"}`}>{t(q.status === "sent" ? "quote.status.sent" : "quote.status.draft")}</span>
                      <span className="sub">{relativeDate(q.sent_at || q.updated_at, new Date(), locale)}</span>
                    </span>
                    <span className="deal-value">{money(Number(q.total || 0))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
