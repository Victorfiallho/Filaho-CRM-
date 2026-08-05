import { describe, expect, it } from "vitest";
import { toGoogleSheetCsvUrl } from "./googleSheets";

describe("toGoogleSheetCsvUrl", () => {
  it("returns an already-CSV url unchanged", () => {
    const url = "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0";
    expect(toGoogleSheetCsvUrl(url)).toBe(url);
    expect(toGoogleSheetCsvUrl("https://example.com/data.csv")).toBe("https://example.com/data.csv");
  });

  it("converts a normal edit-view Sheets url to a CSV export url", () => {
    const url = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=456";
    expect(toGoogleSheetCsvUrl(url)).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456");
  });

  it("defaults gid to 0 when not present", () => {
    const url = "https://docs.google.com/spreadsheets/d/abc123/edit";
    expect(toGoogleSheetCsvUrl(url)).toBe("https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=0");
  });

  it("returns an empty string for an empty input", () => {
    expect(toGoogleSheetCsvUrl("")).toBe("");
  });

  it("returns the url unchanged when it doesn't look like a Sheets url", () => {
    expect(toGoogleSheetCsvUrl("https://example.com/whatever")).toBe("https://example.com/whatever");
  });
});
