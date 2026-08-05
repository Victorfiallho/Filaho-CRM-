import { describe, expect, it } from "vitest";
import { parseCSV } from "./csv";

describe("parseCSV", () => {
  it("parses a simple header + rows", () => {
    const text = "name,phone\nJane,555-1234\nJohn,555-5678";
    expect(parseCSV(text)).toEqual([
      ["name", "phone"],
      ["Jane", "555-1234"],
      ["John", "555-5678"]
    ]);
  });

  it("handles quoted cells containing commas", () => {
    const text = 'name,address\nJane,"123 Main St, Apt 4"';
    expect(parseCSV(text)).toEqual([
      ["name", "address"],
      ["Jane", "123 Main St, Apt 4"]
    ]);
  });

  it("handles escaped double quotes inside quoted cells", () => {
    const text = 'name,note\nJane,"She said ""hi"""';
    expect(parseCSV(text)).toEqual([
      ["name", "note"],
      ["Jane", 'She said "hi"']
    ]);
  });

  it("handles CRLF and bare LF line endings", () => {
    const text = "a,b\r\n1,2\n3,4";
    expect(parseCSV(text)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"]
    ]);
  });

  it("skips fully blank rows", () => {
    const text = "a,b\n1,2\n\n3,4";
    expect(parseCSV(text)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"]
    ]);
  });
});
