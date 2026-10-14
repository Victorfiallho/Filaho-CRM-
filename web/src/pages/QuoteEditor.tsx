import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, CopyPlus, FileDown, Info, PackageSearch, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import { useCatalog, useCustomers, useFinanceSettings, useLeads, useQuote } from "../data/hooks";
import { createQuote, deleteQuote, markQuoteSent, saveQuote, type Quote } from "../data/quotes";
import { dealTitle } from "../domain/deals";
import { formatDay, uid } from "../domain/format";
import { lineFromCatalog, parseDimensions, priceFromCost, QUOTE_SECTIONS, quoteTotals, searchCatalog, unitPrice, type CatalogItem, type QuoteLine, type QuoteSection } from "../domain/quotes";
import { COST_CATEGORIES, type CostCategory } from "../domain/types";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n/messages";
import { errorMessage } from "../lib/errorMessage";
import { downloadQuotePdf } from "../lib/quotePdf";
import { toast, toastError } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { useModal } from "../state/ModalContext";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// A number field that lets the user type freely ("3.", "", "12,5") and only
// reports parsed values. Empty reports null when allowed.
function NumInput({ value, onChange, allowEmpty, placeholder, label, disabled, className }: {
  value: number | null; onChange: (n: number | null) => void; allowEmpty?: boolean; placeholder?: string; label: string; disabled?: boolean; className?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (parsed !== value) setText(value === null ? "" : String(value));
  }
  return (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") { if (allowEmpty) onChange(null); return; }
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n) && n >= 0) onChange(n);
      }}
    />
  );
}

export default function QuoteEditor() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const { activeCompanyId } = useCompany();
  const { t } = useT();
  const { data, isLoading } = useQuote(activeCompanyId, quoteId || null);
  if (!activeCompanyId || isLoading) return <PageSkeleton rows={[4, 8]} />;
  if (!data) {
    return (
      <div className="quote-page">
        <EmptyState icon={Info} action={<Link to="/quotes" className="btn ghost slim">{t("quote.backToList")}</Link>}>{t("quote.notFound")}</EmptyState>
      </div>
    );
  }
  return <QuoteForm key={`${data.quote.id}:${data.quote.status}`} initialQuote={data.quote} initialLines={data.lines} />;
}

function QuoteForm({ initialQuote, initialLines }: { initialQuote: Quote; initialLines: QuoteLine[] }) {
  const { activeCompanyId, activeCompany, stages } = useCompany();
  const { t, locale } = useT();
  const { confirm } = useConfirm();
  const { openRecordModal } = useModal();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: settings } = useFinanceSettings(activeCompanyId);
  const { data: catalog = [], isLoading: catalogLoading } = useCatalog(activeCompanyId);

  const [quote, setQuote] = useState(initialQuote);
  const [lines, setLines] = useState(initialLines);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "pdf" | "version" | "delete">("");
  const [query, setQuery] = useState("");

  const locked = quote.status === "sent";
  const lead = leads.find(l => l.id === quote.lead_id);
  const client = customers.find(c => c.id === (quote.customer_id || lead?.customer_id));
  const filled = lines.filter(l => l.description.trim() || l.sku);
  const totals = quoteTotals(lines, quote);
  const minMargin = Number(settings?.default_minimum_margin_pct ?? 0);
  const belowMin = totals.total > 0 && minMargin > 0 && totals.marginPct < minMargin;

  const doorLines = useMemo(
    () => [...new Set(catalog.map(c => c.color || "").filter(c => c && c.toLowerCase() !== "generic"))].sort(),
    [catalog]
  );
  const results = useMemo(() => searchCatalog(catalog, query, quote.door_line), [catalog, query, quote.door_line]);

  const patch = (p: Partial<Quote>) => { setQuote(q => ({ ...q, ...p })); setDirty(true); };
  const patchLine = (id: string, p: Partial<QuoteLine>) => { setLines(ls => ls.map(l => (l.id === id ? { ...l, ...p } : l))); setDirty(true); };
  const removeLine = (id: string) => { setLines(ls => ls.filter(l => l.id !== id)); setDirty(true); };

  function addFromCatalog(item: CatalogItem) {
    setLines(ls => {
      const same = ls.find(l => l.product_id === item.id);
      if (same) return ls.map(l => (l === same ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, lineFromCatalog(item, uid("qi"))];
    });
    setDirty(true);
  }

  function addManual() {
    const id = uid("qi");
    setLines(ls => [...ls, { id, section: "other", product_id: null, sku: "", description: "", dimensions: "", qty: 1, unit_cost: 0, unit_price: null, cost_category: "employee_labor" }]);
    setDirty(true);
    requestAnimationFrame(() => document.getElementById(`ql-${id}`)?.focus());
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["quote", activeCompanyId, quote.id] });
    queryClient.invalidateQueries({ queryKey: ["quotes", activeCompanyId] });
  };

  async function save(): Promise<boolean> {
    setBusy("save");
    try {
      await saveQuote(quote, filled);
      setDirty(false);
      refresh();
      return true;
    } catch (error) {
      toastError(errorMessage(error, t("quote.saveError")));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function generatePdf() {
    if (!activeCompany) return;
    if (!filled.length) { toastError(t("quote.noLines")); return; }
    if (belowMin && !(await confirm({ message: t("quote.belowMinConfirm", { margin: totals.marginPct.toFixed(1), min: minMargin }) }))) return;
    if (!locked && dirty && !(await save())) return;
    setBusy("pdf");
    try {
      const sent = locked ? quote : { ...quote, status: "sent" as const, sent_at: new Date().toISOString() };
      await downloadQuotePdf({ company: activeCompany, quote: sent, lines: filled, client: client || (lead ? { ...lead } : null) });
      if (!locked) {
        const order = new Map(stages.map(s => [s.id, s.order]));
        await markQuoteSent(quote, totals.total, lead, order);
        queryClient.invalidateQueries({ queryKey: ["leads", activeCompanyId] });
        refresh();
        toast(t("quote.sent"));
      }
    } catch (error) {
      toastError(errorMessage(error, t("quote.pdfError")));
    } finally {
      setBusy("");
    }
  }

  async function newVersion() {
    if (!activeCompanyId || !lead) return;
    setBusy("version");
    try {
      const id = await createQuote(activeCompanyId, lead, { pricing_pct: quote.pricing_pct, deposit_pct: quote.deposit_pct });
      queryClient.invalidateQueries({ queryKey: ["quotes", activeCompanyId] });
      navigate(`/quotes/${id}`);
    } catch (error) {
      toastError(errorMessage(error, t("quote.createError")));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!activeCompanyId || !(await confirm({ message: t("quote.deleteConfirm", { version: quote.version }), danger: true }))) return;
    setBusy("delete");
    try {
      await deleteQuote(activeCompanyId, quote.id);
      queryClient.invalidateQueries({ queryKey: ["quotes", activeCompanyId] });
      navigate("/quotes");
    } catch (error) {
      toastError(errorMessage(error, t("quote.deleteError")));
      setBusy("");
    }
  }

  const openDeal = () => { navigate("/pipeline"); if (lead) openRecordModal("lead", lead); };
  const sectionLabel = (s: QuoteSection) => t(`quote.part.${s}` as MessageKey);
  const categoryLabel = (c: string) => t(`cat.${c}` as MessageKey);

  return (
    <div className="quote-page">
      <nav className="breadcrumb" aria-label={t("quote.breadcrumb")}>
        <Link to="/quotes">{t("nav.quotes")}</Link><ChevronRight aria-hidden="true" />
        <button type="button" className="link-btn" onClick={openDeal}>{lead ? `${lead.name}${dealTitle(lead) ? ` · ${dealTitle(lead)}` : ""}` : t("quote.deal")}</button><ChevronRight aria-hidden="true" />
        <span aria-current="page">{t("quote.versionN", { version: quote.version })}</span>
      </nav>

      <header className="pf-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <input
            className="quote-title-input"
            value={quote.title}
            onChange={e => patch({ title: e.target.value })}
            placeholder={t("quote.titlePlaceholder")}
            aria-label={t("quote.title")}
            disabled={locked}
            maxLength={120}
          />
          <div className="pf-meta">
            <span className={`pill status-${locked ? "approved" : "draft"}`}>{t(locked ? "quote.status.sent" : "quote.status.draft")}</span>
            {client && <span>{client.name}</span>}
            {locked && quote.sent_at && <span>{t("quote.sentOn", { date: formatDay(quote.sent_at, undefined, locale) })}</span>}
          </div>
        </div>
        <div className="inline-actions">
          {locked && <button className="btn ghost slim" onClick={newVersion} disabled={!!busy || !lead}><CopyPlus aria-hidden="true" />{t("quote.newVersion")}</button>}
          <button className="btn slim" onClick={generatePdf} disabled={!!busy}><FileDown aria-hidden="true" />{busy === "pdf" ? t("quote.generating") : t(locked ? "quote.downloadPdf" : "quote.generatePdf")}</button>
        </div>
      </header>

      {locked && (
        <div className="stage-info-banner quote-banner">
          <Info aria-hidden="true" />
          <div>{t("quote.lockedInfo")}</div>
        </div>
      )}

      <div className="quote-layout">
        <div className="quote-main">
          {!locked && (
            <section className="card">
              <div className="card-h">
                <div>
                  <h3>{t("quote.catalog")}</h3>
                  <span className="sub">{catalog.length ? t("quote.catalogSub", { count: catalog.length.toLocaleString(locale) }) : t("quote.catalogEmpty")}</span>
                </div>
                <button className="btn ghost slim" onClick={addManual}><Plus aria-hidden="true" />{t("quote.addManual")}</button>
              </div>
              {(catalog.length > 0 || catalogLoading) && (
                <div className="card-b">
                  <div className="quote-search-row">
                    {doorLines.length > 0 && (
                      <div className="quote-door">
                        <span className="field-label">{t("quote.doorLine")}</span>
                        <Select
                          value={quote.door_line}
                          onChange={v => patch({ door_line: v })}
                          aria-label={t("quote.doorLine")}
                          options={[{ value: "", label: t("quote.allLines") }, ...doorLines.map(d => ({ value: d, label: d }))]}
                        />
                      </div>
                    )}
                    <div className="quote-search">
                      <span className="field-label">{t("quote.search")}</span>
                      <input
                        type="search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={t("quote.searchPlaceholder")}
                        aria-label={t("quote.search")}
                        disabled={catalogLoading}
                      />
                    </div>
                  </div>
                  {query.trim() && (
                    results.length === 0 ? (
                      <EmptyState icon={PackageSearch}>{t("quote.noResults")}</EmptyState>
                    ) : (
                      <ul className="quote-results">
                        {results.map(item => {
                          const dims = parseDimensions(item.description);
                          const inCart = lines.find(l => l.product_id === item.id);
                          return (
                            <li key={item.id}>
                              <button type="button" className="quote-result" onClick={() => addFromCatalog(item)}>
                                <span className="quote-result-main">
                                  <b>{item.cabinet_type || item.detail || item.sku}</b>
                                  <span className="sub">
                                    {item.sku}
                                    {dims.w ? ` · ${dims.w}" W` : ""}{dims.h ? ` × ${dims.h}" H` : ""}{dims.d ? ` × ${dims.d}" D` : ""}
                                    {!quote.door_line && item.color ? ` · ${item.color}` : ""}
                                  </span>
                                </span>
                                <span className="quote-result-price">
                                  <b>{usd(priceFromCost(item.price, quote.pricing_method, quote.pricing_pct))}</b>
                                  <span className="sub">{t("quote.costShort", { amount: usd(item.price) })}</span>
                                </span>
                                <span className="quote-result-add" aria-hidden="true">{inCart ? `+1 (${inCart.qty})` : <Plus />}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  )}
                </div>
              )}
            </section>
          )}

          <section className="card">
            <div className="card-h">
              <div>
                <h3>{t("quote.items")}</h3>
                <span className="sub">{t("quote.itemsSub", { count: lines.length })}</span>
              </div>
            </div>
            <div className="card-b">
              {lines.length === 0 ? (
                <EmptyState icon={PackageSearch}>{t("quote.noItems")}</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="quote-table">
                    <thead>
                      <tr>
                        <th>{t("quote.col.item")}</th>
                        <th className="num">{t("quote.col.qty")}</th>
                        <th className="num">{t("quote.col.cost")}</th>
                        <th className="num">{t("quote.col.price")}</th>
                        <th className="num">{t("quote.col.total")}</th>
                        {!locked && <th><span className="sr-only">{t("quote.col.actions")}</span></th>}
                      </tr>
                    </thead>
                    {QUOTE_SECTIONS.filter(s => lines.some(l => l.section === s)).map(section => (
                      <tbody key={section}>
                        <tr className="quote-section-row">
                          <th colSpan={locked ? 5 : 6} scope="colgroup">
                            {sectionLabel(section)}
                            <span className="sub"> · {usd(totals.bySection.find(b => b.section === section)?.price || 0)}</span>
                          </th>
                        </tr>
                        {lines.filter(l => l.section === section).map(l => {
                          const price = unitPrice(l, quote);
                          return (
                            <tr key={l.id}>
                              <td className="quote-item-cell">
                                <input
                                  id={`ql-${l.id}`}
                                  className="quote-cell-input"
                                  value={l.description}
                                  onChange={e => patchLine(l.id, { description: e.target.value })}
                                  placeholder={t("quote.descPlaceholder")}
                                  aria-label={t("quote.col.item")}
                                  disabled={locked}
                                />
                                {l.product_id ? (
                                  <span className="sub">{[l.sku, l.dimensions.replace(/''/g, "\"").replace(/\*/g, " × ")].filter(Boolean).join(" · ")}</span>
                                ) : !locked && (
                                  <div className="quote-line-meta">
                                    <Select value={l.section} onChange={v => patchLine(l.id, { section: v as QuoteSection })} aria-label={t("quote.section")} options={QUOTE_SECTIONS.map(s => ({ value: s, label: sectionLabel(s) }))} />
                                    <Select value={l.cost_category} onChange={v => patchLine(l.id, { cost_category: v as CostCategory })} aria-label={t("quote.costCategory")} options={COST_CATEGORIES.map(c => ({ value: c, label: categoryLabel(c) }))} />
                                  </div>
                                )}
                              </td>
                              <td className="num"><NumInput className="quote-cell-input num qty" value={l.qty} onChange={n => n && patchLine(l.id, { qty: n })} label={t("quote.col.qty")} disabled={locked} /></td>
                              <td className="num"><NumInput className="quote-cell-input num" value={l.unit_cost} onChange={n => patchLine(l.id, { unit_cost: n ?? 0 })} label={t("quote.col.cost")} disabled={locked || Boolean(l.product_id)} /></td>
                              <td className="num">
                                <NumInput
                                  className={`quote-cell-input num${l.unit_price === null ? " auto" : ""}`}
                                  value={l.unit_price}
                                  allowEmpty
                                  placeholder={price.toFixed(2)}
                                  onChange={n => patchLine(l.id, { unit_price: n })}
                                  label={t("quote.col.price")}
                                  disabled={locked}
                                />
                              </td>
                              <td className="num"><b>{usd(price * l.qty)}</b></td>
                              {!locked && (
                                <td className="num">
                                  <button type="button" className="round-btn danger small" onClick={() => removeLine(l.id)} aria-label={t("quote.removeLine", { name: l.description || l.sku || "" })}><Trash2 aria-hidden="true" /></button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    ))}
                  </table>
                </div>
              )}
              {!locked && <p className="sub quote-hint">{t("quote.priceHint")}</p>}
            </div>
          </section>
        </div>

        <aside className="quote-side">
          <section className="card">
            <div className="card-h"><h3>{t("quote.pricing")}</h3></div>
            <div className="card-b quote-settings">
              <div className="quote-setting">
                <span className="field-label">{t("quote.method")}</span>
                <Select
                  value={quote.pricing_method}
                  onChange={v => patch({ pricing_method: v as Quote["pricing_method"], pricing_pct: v === "margin" ? Math.min(quote.pricing_pct, 95) : quote.pricing_pct })}
                  aria-label={t("quote.method")}
                  disabled={locked}
                  options={[{ value: "margin", label: t("quote.method.margin") }, { value: "markup", label: t("quote.method.markup") }]}
                />
              </div>
              <label className="quote-setting">
                <span className="field-label">{t("quote.pct")}</span>
                <NumInput value={quote.pricing_pct} onChange={n => patch({ pricing_pct: quote.pricing_method === "margin" ? Math.min(n ?? 0, 95) : n ?? 0 })} label={t("quote.pct")} disabled={locked} />
              </label>
              <label className="quote-setting">
                <span className="field-label">{t("quote.discount")}</span>
                <NumInput value={quote.discount} onChange={n => patch({ discount: n ?? 0 })} label={t("quote.discount")} disabled={locked} />
              </label>
              <label className="quote-setting">
                <span className="field-label">{t("quote.deposit")}</span>
                <NumInput value={quote.deposit_pct} onChange={n => patch({ deposit_pct: Math.min(n ?? 0, 100) })} label={t("quote.deposit")} disabled={locked} />
              </label>
              <label className="quote-setting">
                <span className="field-label">{t("quote.validDays")}</span>
                <NumInput value={quote.valid_days} onChange={n => n && patch({ valid_days: Math.round(n) })} label={t("quote.validDays")} disabled={locked} />
              </label>
            </div>
          </section>

          <section className="card quote-totals">
            <div className="card-b">
              <dl>
                <div><dt>{t("quote.t.subtotal")}</dt><dd>{usd(totals.subtotal)}</dd></div>
                {totals.discount > 0 && <div><dt>{t("quote.t.discount")}</dt><dd>- {usd(totals.discount)}</dd></div>}
                <div className="quote-total-row"><dt>{t("quote.t.total")}</dt><dd>{usd(totals.total)}</dd></div>
                <div><dt>{t("quote.t.deposit", { pct: quote.deposit_pct })}</dt><dd>{usd(totals.deposit)}</dd></div>
              </dl>
              <div className="quote-internal">
                <span className="field-label">{t("quote.internal")}</span>
                <dl>
                  <div><dt>{t("quote.t.cost")}</dt><dd>{usd(totals.cost)}</dd></div>
                  <div><dt>{t("quote.t.profit")}</dt><dd>{usd(totals.profit)}</dd></div>
                  <div className={belowMin ? "quote-warn" : ""}><dt>{t("quote.t.margin")}</dt><dd>{totals.marginPct.toFixed(1)}%</dd></div>
                </dl>
                {belowMin && <p className="quote-warn-text"><AlertTriangle aria-hidden="true" />{t("quote.belowMin", { min: minMargin })}</p>}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-h"><h3>{t("quote.notes")}</h3></div>
            <div className="card-b">
              <textarea
                className="quote-notes"
                rows={5}
                value={quote.notes}
                onChange={e => patch({ notes: e.target.value })}
                placeholder={t("quote.notesPlaceholder")}
                aria-label={t("quote.notes")}
                disabled={locked}
              />
              <p className="sub">{t("quote.notesHint")}</p>
            </div>
          </section>

          <button type="button" className="btn ghost danger-text quote-delete" onClick={remove} disabled={!!busy}><Trash2 aria-hidden="true" />{t("quote.delete")}</button>
        </aside>
      </div>

      {dirty && !locked && (
        <div className="savebar" role="region" aria-label={t("quote.unsaved")}>
          <span className="sub">{t("quote.unsaved")}</span>
          <button className="btn" onClick={save} disabled={!!busy}>{busy === "save" ? t("quote.saving") : t("quote.save")}</button>
        </div>
      )}
    </div>
  );
}
