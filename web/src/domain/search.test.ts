import { describe, expect, it } from "vitest";
import { filterRowsBySearch } from "./search";

const rows = [
  { name: "Jane Doe", phone: "5551234567", city: "Atlanta", service_type: "Deep Cleaning", status: "active" },
  { name: "John Smith", phone: "5559876543", city: "Marietta", service_type: "Recurring Cleaning", status: "past" }
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

  it("returns an empty array when nothing matches", () => {
    expect(filterRowsBySearch(rows, "nonexistent")).toEqual([]);
  });
});
