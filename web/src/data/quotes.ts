import { now, uid } from "../domain/format";
import { quoteTotals, unitPrice, type CatalogItem, type PricingMethod, type QuoteLine, type QuoteSection } from "../domain/quotes";
import type { CostCategory, Lead } from "../domain/types";
import { supabase } from "../lib/supabaseClient";
import { insertCostLineItem } from "./costLineItems";

export interface Quote {
  id: string;
  company_id: string;
  lead_id: string | null;
  customer_id: string | null;
  version: number;
  title: string;
  door_line: string;
  pricing_method: PricingMethod;
  pricing_pct: number;
  discount: number;
  deposit_pct: number;
  valid_days: number;
  notes: string;
  status: "draft" | "sent";
  cost_total: number;
  total: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QuoteItemRow extends QuoteLine {
  quote_id: string;
  company_id: string;
  position: number;
}

const num = (v: unknown) => Number(v) || 0;

export async function listQuotesForLead(companyId: string, leadId: string): Promise<Quote[]> {
  const { data, error } = await supabase.from("quotes").select("*").eq("company_id", companyId).eq("lead_id", leadId).order("version", { ascending: false });
  if (error) throw error;
  return (data || []) as Quote[];
}

export async function getQuote(companyId: string, id: string): Promise<{ quote: Quote; lines: QuoteLine[] } | null> {
  const [{ data: quote, error }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("quotes").select("*").eq("company_id", companyId).eq("id", id).maybeSingle(),
    supabase.from("quote_items").select("*").eq("company_id", companyId).eq("quote_id", id).order("position")
  ]);
  if (error) throw error;
  if (itemsError) throw itemsError;
  if (!quote) return null;
  const lines: QuoteLine[] = (items || []).map(r => ({
    id: r.id,
    section: r.section as QuoteSection,
    product_id: r.product_id,
    sku: r.sku,
    description: r.description,
    dimensions: r.dimensions,
    qty: num(r.qty),
    unit_cost: num(r.unit_cost),
    unit_price: r.unit_price === null ? null : num(r.unit_price),
    cost_category: r.cost_category as CostCategory
  }));
  return { quote: quote as Quote, lines };
}

// Next version for the deal, starting from the previous one's settings and
// lines when there is one, else from the company's margin and deposit.
export async function createQuote(companyId: string, lead: Lead, defaults: { pricing_pct: number; deposit_pct: number }): Promise<string> {
  const previous = (await listQuotesForLead(companyId, lead.id))[0];
  const id = uid("quote");
  const base = previous
    ? { title: previous.title, door_line: previous.door_line, pricing_method: previous.pricing_method, pricing_pct: previous.pricing_pct, discount: previous.discount, deposit_pct: previous.deposit_pct, valid_days: previous.valid_days, notes: previous.notes }
    : { title: [lead.title, lead.service_type].filter(Boolean).join(" · "), door_line: "", pricing_method: "margin" as const, pricing_pct: defaults.pricing_pct, discount: 0, deposit_pct: defaults.deposit_pct, valid_days: 30, notes: "" };
  const { error } = await supabase.from("quotes").insert({
    id, company_id: companyId, lead_id: lead.id, customer_id: lead.customer_id, version: (previous?.version || 0) + 1, status: "draft", ...base,
    cost_total: previous?.cost_total || 0, total: previous?.total || 0
  });
  if (error) throw error;
  if (previous) {
    const copy = await getQuote(companyId, previous.id);
    if (copy?.lines.length) await replaceItems(companyId, id, copy.lines.map(l => ({ ...l, id: uid("qi") })));
  }
  return id;
}

async function replaceItems(companyId: string, quoteId: string, lines: QuoteLine[]) {
  const { error } = await supabase.from("quote_items").delete().eq("company_id", companyId).eq("quote_id", quoteId);
  if (error) throw error;
  if (!lines.length) return;
  const rows: QuoteItemRow[] = lines.map((l, position) => ({ ...l, quote_id: quoteId, company_id: companyId, position }));
  const { error: insertError } = await supabase.from("quote_items").insert(rows);
  if (insertError) throw insertError;
}

export async function saveQuote(quote: Quote, lines: QuoteLine[]): Promise<void> {
  const totals = quoteTotals(lines, quote);
  const { error } = await supabase.from("quotes").update({
    title: quote.title, door_line: quote.door_line, pricing_method: quote.pricing_method, pricing_pct: quote.pricing_pct,
    discount: quote.discount, deposit_pct: quote.deposit_pct, valid_days: quote.valid_days, notes: quote.notes,
    cost_total: totals.cost, total: totals.total, updated_at: now()
  }).eq("company_id", quote.company_id).eq("id", quote.id);
  if (error) throw error;
  await replaceItems(quote.company_id, quote.id, lines);
}

// The PDF went to the client: mark the quote sent, put its total on the
// deal and move the deal to "Estimate Sent" if it hasn't got that far yet.
export async function markQuoteSent(quote: Quote, total: number, lead: Lead | undefined, stageOrder: Map<string, number>): Promise<void> {
  const { error } = await supabase.from("quotes").update({ status: "sent", sent_at: now(), total }).eq("company_id", quote.company_id).eq("id", quote.id);
  if (error) throw error;
  if (!lead) return;
  const patch: Record<string, unknown> = { value: total, updated_at: now() };
  const estimate = stageOrder.get("estimate");
  if (estimate !== undefined && (stageOrder.get(lead.stage_id) ?? 0) < estimate) patch.stage_id = "estimate";
  const { error: leadError } = await supabase.from("leads").update(patch).eq("company_id", quote.company_id).eq("id", lead.id);
  if (leadError) throw leadError;
}

export async function deleteQuote(companyId: string, id: string): Promise<void> {
  const { error } = await supabase.from("quotes").delete().eq("company_id", companyId).eq("id", id);
  if (error) throw error;
}

// A won deal's job starts its costing from the latest sent quote (or the
// latest one): one planned cost line per quote line.
export async function seedJobCostsFromQuote(companyId: string, jobId: string, leadId: string): Promise<number> {
  const quotes = await listQuotesForLead(companyId, leadId);
  const quote = quotes.find(q => q.status === "sent") || quotes[0];
  if (!quote) return 0;
  const full = await getQuote(companyId, quote.id);
  if (!full) return 0;
  for (const l of full.lines) {
    await insertCostLineItem({
      company_id: companyId, job_id: jobId, category: l.cost_category,
      description: [l.sku, l.description].filter(Boolean).join(" · "),
      vendor_id: null, estimated_cost: Math.round(l.unit_cost * l.qty * 100) / 100,
      quoted_to_customer: Math.round(unitPrice(l, quote) * l.qty * 100) / 100,
      committed_amount: 0, actual_paid: 0, internal_cost: 0, tax: 0, freight: 0, discount: 0, returned_amount: 0,
      expected_date: null, purchase_date: null, payment_method: "", status: "planned",
      responsible_user_id: null, receipt_id: null, notes: l.qty > 1 ? `Qty ${l.qty}` : ""
    });
  }
  return full.lines.length;
}

// The supplier catalog, paged past the API's 1000-row limit.
export async function listCatalog(companyId: string): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("supplier_products")
      .select("id, sku, item_category, cabinet_type, color, detail, description, price, stock, is_available")
      .eq("company_id", companyId)
      .order("sku")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data || []) as CatalogItem[]).map(r => ({ ...r, price: num(r.price) })));
    if (!data || data.length < 1000) break;
  }
  return out;
}
