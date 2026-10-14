import { describe, expect, it } from "vitest";
import { filterRowsBySearch } from "./search";

const rows = [
  { name: "Jane Doe", phone: "(555) 123-4567", city: "Atlanta", service_type: "Deep Cleaning", status: "active" },
  { name: "John Smith", phone: "5559876543", city: "Marietta", service_type: "Recurring Cleaning", status: "past" },
  { name: "José Álvares", title: "Master bathroom", phone: "", email: "jose@alvares.com", service_type: "Bathroom Vanities" }
];

describe("filterRowsBySearch", () => {
  it("returns everything for a blank query", () => {
    expect(filterRowsBySearch(rows, "")).toEqual(rows);
    expect(filterRowsBySearch(rows, "   ")).toEqual(rows);
  });

  it("matches case-insensitively across name/phone/city/service/status", () => {
    expect(filterRowsBySearch(rows, "jane")).toEqual([rows[0]]);
    expect(filterRowsBySearch(rows, "MARIETTA")).toEqual([rows[1]]);
    expect(filterRowsBySearch(rows, "recurring")).toEqual([rows[1]]);
    expect(filterRowsBySearch(rows, "past")).toEqual([rows[1]]);
  });

  it("ignores accents and needs every word to match somewhere", () => {
    expect(filterRowsBySearch(rows, "jose alvares")).toEqual([rows[2]]);
    expect(filterRowsBySearch(rows, "José master")).toEqual([rows[2]]);
    expect(filterRowsBySearch(rows, "jane marietta")).toEqual([]);
  });

  it("finds a phone by its digits however it's typed", () => {
    expect(filterRowsBySearch(rows, "5551234567")).toEqual([rows[0]]);
    expect(filterRowsBySearch(rows, "555-987")).toEqual([rows[1]]);
    expect(filterRowsBySearch(rows, "(555) 123")).toEqual([rows[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRowsBySearch(rows, "nonexistent")).toEqual([]);
  });
});
