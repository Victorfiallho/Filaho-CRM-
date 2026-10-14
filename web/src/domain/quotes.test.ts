import { describe, expect, it } from "vitest";
import { lineFromCatalog, parseDimensions, priceFromCost, quoteTotals, searchCatalog, sectionFor, type CatalogItem, type QuoteLine } from "./quotes";

describe("priceFromCost", () => {
  it("margin divides, markup multiplies (the CRM's margin policy)", () => {
    expect(priceFromCost(4000, "margin", 35)).toBe(6153.85);
    expect(priceFromCost(4000, "markup", 35)).toBe(5400);
    expect(priceFromCost(100, "margin", 0)).toBe(100);
  });
});

const line = (over: Partial<QuoteLine>): QuoteLine => ({
  id: "x", section: "base", product_id: null, sku: "", description: "", dimensions: "", qty: 1, unit_cost: 0, unit_price: null, cost_category: "cabinets", ...over
});

describe("quoteTotals", () => {
  it("adds catalog and manual lines, applies the discount, deposit and margin", () => {
    const t = quoteTotals([
      line({ section: "base", unit_cost: 166.43, qty: 2 }),
      line({ section: "other", unit_cost: 800, unit_price: 1200, cost_category: "employee_labor" })
    ], { pricing_method: "margin", pricing_pct: 35, discount: 12.1, deposit_pct: 65 });
    expect(t.cost).toBe(1132.86);
    expect(t.subtotal).toBe(1712.1); // 256.05 × 2 + 1200
    expect(t.total).toBe(1700);
    expect(t.profit).toBe(567.14);
    expect(t.marginPct).toBe(33.36);
    expect(t.deposit).toBe(1105);
    expect(t.bySection.map(s => s.section)).toEqual(["base", "other"]);
  });

  it("never discounts below zero", () => {
    expect(quoteTotals([line({ unit_cost: 10, unit_price: 10 })], { pricing_method: "margin", pricing_pct: 35, discount: 50, deposit_pct: 0 }).total).toBe(0);
  });
});

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  id: "p", sku: "", item_category: "Base Cabinets", cabinet_type: "", color: "Atlanta White", detail: "", description: "", price: 100, stock: 5, is_available: true, ...over
});

describe("catalog", () => {
  it("reads Muses dimensions, fractions included", () => {
    expect(parseDimensions("18''W*34-1/2''H*24''D")).toEqual({ w: 18, h: 34.5, d: 24 });
    expect(parseDimensions("20-3/4''W*29-5/8''H*5/8''D")).toEqual({ w: 20.75, h: 29.625, d: 0.625 });
  });

  it("puts items in quote sections", () => {
    expect(sectionFor({ item_category: "Wall Cabinets", cabinet_type: "Wall" })).toBe("wall");
    expect(sectionFor({ item_category: "Oven and Pantry Cabinets", cabinet_type: "Pantry" })).toBe("tall");
    expect(sectionFor({ item_category: "Trim & Details", cabinet_type: "Filler" })).toBe("trim");
    expect(sectionFor({ item_category: "Base Cabinets", cabinet_type: "3-Drawer Base" })).toBe("base");
  });

  it("searches by words and width within the door line", () => {
    const items = [
      item({ id: "a", sku: "AW-DB18-3", cabinet_type: "3-Drawer Base", description: "18''W*34-1/2''H*24''D" }),
      item({ id: "b", sku: "AW-B24", cabinet_type: "Base", description: "24''W*34-1/2''H*24''D" }),
      item({ id: "c", sku: "TPG-B18", cabinet_type: "Base", color: "Thielsen Pebble Gray", description: "18''W*34-1/2''H*24''D" }),
      item({ id: "d", sku: "AW-W3030", item_category: "Wall Cabinets", cabinet_type: "Wall", description: "30''W*30''H*12''D", is_available: false })
    ];
    expect(searchCatalog(items, "base 18", "Atlanta White").map(i => i.id)).toEqual(["a"]);
    expect(searchCatalog(items, "base", "Atlanta White").map(i => i.id)).toEqual(["a", "b"]);
    expect(searchCatalog(items, "db18", "").map(i => i.id)).toEqual(["a"]);
    expect(searchCatalog(items, "wall", "Atlanta White")).toEqual([]); // unavailable
  });

  it("makes a quote line with the supplier cost frozen", () => {
    expect(lineFromCatalog(item({ id: "a", sku: "AW-DB18-3", cabinet_type: "3-Drawer Base", description: "18''W", price: 166.43 }), "q1"))
      .toMatchObject({ product_id: "a", sku: "AW-DB18-3", section: "base", unit_cost: 166.43, unit_price: null, qty: 1 });
  });
});
