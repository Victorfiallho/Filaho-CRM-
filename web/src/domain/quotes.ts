// Quote math and catalog search. A line's price comes from its cost with the
// quote's method unless the line sets its own price:
//   margin  35% → price = cost / (1 - 0.35)   (the CRM's margin policy)
//   markup  35% → price = cost × 1.35
import type { CostCategory } from "./types";

export type PricingMethod = "margin" | "markup";

export const QUOTE_SECTIONS = ["base", "wall", "tall", "vanity", "trim", "accessories", "other"] as const;
export type QuoteSection = typeof QUOTE_SECTIONS[number];

export interface QuoteLine {
  id: string;
  section: QuoteSection;
  product_id: string | null;
  sku: string;
  description: string;
  dimensions: string;
  qty: number;
  unit_cost: number;
  unit_price: number | null;
  cost_category: CostCategory;
}

export interface QuotePricing {
  pricing_method: PricingMethod;
  pricing_pct: number;
  discount: number;
  deposit_pct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function priceFromCost(cost: number, method: PricingMethod, pct: number): number {
  if (method === "markup") return round2(cost * (1 + pct / 100));
  if (pct >= 100) return 0;
  return round2(cost / (1 - pct / 100));
}

export function unitPrice(line: Pick<QuoteLine, "unit_cost" | "unit_price">, p: Pick<QuotePricing, "pricing_method" | "pricing_pct">): number {
  return line.unit_price ?? priceFromCost(line.unit_cost, p.pricing_method, p.pricing_pct);
}

export interface QuoteTotals {
  cost: number;
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
  marginPct: number;
  deposit: number;
  bySection: { section: QuoteSection; cost: number; price: number }[];
}

export function quoteTotals(lines: QuoteLine[], p: QuotePricing): QuoteTotals {
  const bySection = new Map<QuoteSection, { cost: number; price: number }>();
  let cost = 0, subtotal = 0;
  for (const l of lines) {
    const c = l.unit_cost * l.qty;
    const pr = unitPrice(l, p) * l.qty;
    cost += c;
    subtotal += pr;
    const s = bySection.get(l.section) || { cost: 0, price: 0 };
    bySection.set(l.section, { cost: s.cost + c, price: s.price + pr });
  }
  const discount = Math.min(Math.max(0, p.discount || 0), subtotal);
  const total = round2(subtotal - discount);
  const profit = round2(total - cost);
  return {
    cost: round2(cost),
    subtotal: round2(subtotal),
    discount: round2(discount),
    total,
    profit,
    marginPct: total > 0 ? round2((profit / total) * 100) : 0,
    deposit: round2((total * (p.deposit_pct || 0)) / 100),
    bySection: QUOTE_SECTIONS.filter(s => bySection.has(s)).map(s => ({ section: s, ...bySection.get(s)! }))
  };
}

// ── Catalog ──────────────────────────────────────────────────────────────
export interface CatalogItem {
  id: string;
  sku: string;
  item_category: string | null;
  cabinet_type: string | null;
  color: string | null;
  detail: string | null;
  description: string | null;
  price: number;
  stock: number | null;
  is_available: boolean | null;
}

// "18''W*34-1/2''H*24''D" → { w: 18, h: 34.5, d: 24 }
export function parseDimensions(text: string | null | undefined): { w?: number; h?: number; d?: number } {
  const out: { w?: number; h?: number; d?: number } = {};
  // Whole, whole-num/den or num/den: 18, 34-1/2, 5/8.
  for (const m of String(text || "").matchAll(/(?:(\d+)-)?(\d+(?:\.\d+)?)(?:\/(\d+))?\s*(?:''|"|”)?\s*([WHD])\b/gi)) {
    const value = m[3] ? Number(m[1] || 0) + Number(m[2]) / Number(m[3]) : Number(m[2]);
    out[m[4].toLowerCase() as "w" | "h" | "d"] = value;
  }
  return out;
}

export function sectionFor(item: Pick<CatalogItem, "item_category" | "cabinet_type">): QuoteSection {
  const c = `${item.item_category || ""} ${item.cabinet_type || ""}`.toLowerCase();
  if (c.includes("vanit")) return "vanity";
  if (c.includes("pantry") || c.includes("oven") || c.includes("tall")) return "tall";
  if (c.includes("wall")) return "wall";
  if (c.includes("trim") || c.includes("molding") || c.includes("filler") || c.includes("panel")) return "trim";
  if (c.includes("accessor")) return "accessories";
  if (c.includes("base")) return "base";
  return "other";
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Every word must match the SKU, type, category or detail; a bare number
// matches the width ("base 18" = 18" wide bases).
export function searchCatalog(items: CatalogItem[], query: string, doorLine: string, limit = 12): CatalogItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const line = fold(doorLine);
  const hits = items.filter(it => {
    if (it.is_available === false) return false;
    if (line && fold(it.color || "") !== line && fold(it.color || "") !== "generic") return false;
    const text = fold([it.sku, it.cabinet_type, it.item_category, it.detail].join(" "));
    const width = parseDimensions(it.description).w;
    return words.every(w => (/^\d+(\.\d+)?$/.test(w) ? width === Number(w) || text.includes(w) : text.includes(w)));
  });
  return hits
    .sort((a, b) => (parseDimensions(a.description).w || 0) - (parseDimensions(b.description).w || 0) || a.sku.localeCompare(b.sku))
    .slice(0, limit);
}

export function lineFromCatalog(item: CatalogItem, id: string): QuoteLine {
  return {
    id,
    section: sectionFor(item),
    product_id: item.id,
    sku: item.sku,
    description: item.cabinet_type || item.detail || item.sku,
    dimensions: item.description || "",
    qty: 1,
    unit_cost: Number(item.price) || 0,
    unit_price: null,
    cost_category: "cabinets"
  };
}
