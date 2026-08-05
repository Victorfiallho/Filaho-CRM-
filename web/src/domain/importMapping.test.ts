import { describe, expect, it } from "vitest";
import { autoMapHeaders, mappedRecord, stageFromValue } from "./importMapping";

describe("stageFromValue", () => {
  it("maps free-text status/stage values to pipeline stage ids", () => {
    expect(stageFromValue("Won")).toBe("won");
    expect(stageFromValue("Closed")).toBe("won");
    expect(stageFromValue("Complete")).toBe("won");
    expect(stageFromValue("Scheduled")).toBe("scheduled");
    expect(stageFromValue("Booked")).toBe("scheduled");
    expect(stageFromValue("Estimate sent")).toBe("estimate");
    expect(stageFromValue("Quoted")).toBe("estimate");
    expect(stageFromValue("Contacted")).toBe("contacted");
    expect(stageFromValue("Anything else")).toBe("new");
    expect(stageFromValue(undefined)).toBe("new");
  });
});

describe("autoMapHeaders", () => {
  it("matches headers to fields by name", () => {
    const headers = ["Name", "Phone", "Email", "City"];
    const mapping = autoMapHeaders(headers, "csv");
    expect(mapping.name).toBe("Name");
    expect(mapping.phone).toBe("Phone");
    expect(mapping.email).toBe("Email");
    expect(mapping.city).toBe("City");
  });

  it("uses preset aliases for calendar CSV imports", () => {
    const headers = ["Subject", "Start Date", "Location"];
    const mapping = autoMapHeaders(headers, "calendar");
    expect(mapping.name).toBe("Subject");
    expect(mapping.scheduled_date).toBe("Start Date");
    expect(mapping.address).toBe("Location");
  });

  it("leaves a field unmapped when no header matches", () => {
    const mapping = autoMapHeaders(["Unrelated Column"], "csv");
    expect(mapping.name).toBeUndefined();
  });
});

describe("mappedRecord", () => {
  const headers = ["Full Name", "Phone", "Status", "Value"];
  const mapping = { name: "Full Name", phone: "Phone", status: "Status", value: "Value" };

  it("maps a row using the header->field mapping", () => {
    const row = ["Jane Doe", "555-1234", "Won", "$1,200"];
    const record = mappedRecord(row, headers, mapping, "peach_fresh", "CSV upload");
    expect(record.company_id).toBe("peach_fresh");
    expect(record.source).toBe("CSV upload");
    expect(record.name).toBe("Jane Doe");
    expect(record.phone).toBe("555-1234");
    expect(record.stage_id).toBe("won");
    expect(record.status).toBe("Won");
    expect(record.value).toBe(1200);
  });

  it("derives a name from the email when name is blank", () => {
    const headersWithEmail = ["Full Name", "Email"];
    const mappingWithEmail = { name: "Full Name", email: "Email" };
    const record = mappedRecord(["", "jane@example.com"], headersWithEmail, mappingWithEmail, "peach_fresh", "CSV upload");
    expect(record.name).toBe("jane");
  });

  it("defaults status to active and value to 0 when missing", () => {
    const record = mappedRecord(["Jane Doe", "", "", ""], headers, mapping, "peach_fresh", "CSV upload");
    expect(record.status).toBe("active");
    expect(record.value).toBe(0);
    expect(record.stage_id).toBe("new");
  });
});
