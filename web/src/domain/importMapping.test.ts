import { describe, expect, it } from "vitest";
import { autoMapHeaders, importTemplateCsvRows, importUpdatePatch, mappedRecord, resolveImportStage, stageFromValue } from "./importMapping";
import type { PipelineStage } from "./types";

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

const stage = (id: string, name: string, order: number, type = "open"): PipelineStage =>
  ({ id, company_id: "c", name, order, color: null, type, win_probability: 0 });
const STAGES = [
  stage("lead_in", "Lead in", 1), stage("visit", "Site visit", 2), stage("estimate", "Estimate Sent", 3),
  stage("closed", "Fechado", 4, "won"), stage("gone", "Lost", 5, "lost")
];

describe("resolveImportStage", () => {
  it("matches the company's stages by id or name, ignoring case and accents", () => {
    expect(resolveImportStage("visit", STAGES)).toBe("visit");
    expect(resolveImportStage("SITE VISIT", STAGES)).toBe("visit");
    expect(resolveImportStage("fechado", STAGES)).toBe("closed");
  });

  it("uses stage types for won and lost keywords", () => {
    expect(resolveImportStage("Won", STAGES)).toBe("closed");
    expect(resolveImportStage("Perdido", STAGES)).toBe("gone");
  });

  it("falls back to the first open stage for blanks and unknown values", () => {
    expect(resolveImportStage("", STAGES)).toBe("lead_in");
    expect(resolveImportStage("Contacted", STAGES)).toBe("lead_in");
    expect(resolveImportStage("Orçamento", STAGES)).toBe("estimate");
  });
});

describe("autoMapHeaders with Portuguese headers", () => {
  it("maps accented Portuguese column names", () => {
    const mapping = autoMapHeaders(["Nome", "Telefone", "E-mail", "Endereço", "CEP", "Serviço", "Etapa", "Valor", "Observações"], "csv");
    expect(mapping).toMatchObject({
      name: "Nome", phone: "Telefone", email: "E-mail", address: "Endereço", zip: "CEP",
      service_type: "Serviço", stage_id: "Etapa", value: "Valor", notes: "Observações"
    });
  });

  it("maps every column of the downloadable template", () => {
    const { headers } = importTemplateCsvRows(STAGES, ["Kitchen"]);
    const mapping = autoMapHeaders(headers, "csv");
    expect(Object.values(mapping).sort()).toEqual([...headers].sort());
  });
});

describe("importUpdatePatch", () => {
  it("only writes mapped, non-blank cells", () => {
    const mapping = { name: "Name", phone: "Phone", email: "Email", status: "Status" };
    const patch = importUpdatePatch({ name: "Jane", phone: "", status: "active", source: "CSV upload" }, mapping);
    expect(patch).toEqual({ name: "Jane", status: "active" });
  });

  it("does not touch status when no status column was mapped", () => {
    const patch = importUpdatePatch({ name: "Jane", status: "active" }, { name: "Name" });
    expect(patch).toEqual({ name: "Jane" });
  });
});
