import { describe, expect, it } from "vitest";
import { clientStanding, dealsForClient, dealTitle, otherDealCounts, searchClients } from "./deals";
import type { Lead, PipelineStage } from "./types";

const stages = [
  { id: "new", type: "open" },
  { id: "won", type: "won" },
  { id: "lost", type: "lost" }
] as PipelineStage[];

const lead = (id: string, customer_id: string, stage_id: string, created_at: string, extra: Partial<Lead> = {}) =>
  ({ id, customer_id, stage_id, created_at, service_type: "Kitchen Cabinets", title: "", ...extra }) as Lead;

describe("dealTitle", () => {
  it("uses the deal's title, then the service", () => {
    expect(dealTitle({ title: " Master bathroom ", service_type: "Bathroom Vanities" })).toBe("Master bathroom");
    expect(dealTitle({ title: "", service_type: "Bathroom Vanities" })).toBe("Bathroom Vanities");
    expect(dealTitle({ title: undefined, service_type: "" })).toBe("");
  });
});

describe("searchClients", () => {
  const clients = [
    { name: "Ana Souza", phone: "(404) 555-0100", email: "ana@x.com" },
    { name: "Bob Lee", phone: "(678) 555-0199", email: "bob@lee.com" },
    { name: "Mariana Ana", phone: "", email: "" },
    { name: "José Álvares", phone: "", email: "" }
  ];
  it("matches name (accents ignored), email or phone digits, name-start first", () => {
    expect(searchClients(clients, "ana").map(c => c.name)).toEqual(["Ana Souza", "Mariana Ana"]);
    expect(searchClients(clients, "jose alv").map(c => c.name)).toEqual(["José Álvares"]);
    expect(searchClients(clients, "678-555").map(c => c.name)).toEqual(["Bob Lee"]);
    expect(searchClients(clients, "lee.com").map(c => c.name)).toEqual(["Bob Lee"]);
    expect(searchClients(clients, "  ")).toEqual([]);
  });
});

describe("otherDealCounts", () => {
  it("counts the same client's other deals", () => {
    const counts = otherDealCounts([{ id: "a", customer_id: "c1" }, { id: "b", customer_id: "c1" }, { id: "c", customer_id: "c2" }, { id: "d", customer_id: null }]);
    expect([...counts]).toEqual([["a", 1], ["b", 1], ["c", 0], ["d", 0]]);
  });
});

describe("clientStanding", () => {
  it("is a client once a deal is won or a job exists; counts open deals", () => {
    const leads = [
      { customer_id: "c1", stage_id: "won" }, { customer_id: "c1", stage_id: "new" },
      { customer_id: "c2", stage_id: "new" }, { customer_id: "c2", stage_id: "lost" },
      { customer_id: "c3", stage_id: "lost" }
    ];
    const s = clientStanding(leads, [{ customer_id: "c3" }], stages);
    expect(s.get("c1")).toEqual({ kind: "client", open: 1 });
    expect(s.get("c2")).toEqual({ kind: "lead", open: 1 });
    expect(s.get("c3")).toEqual({ kind: "client", open: 0 });
    expect(s.get("nobody")).toBeUndefined();
  });
});

describe("dealsForClient", () => {
  it("lists only that client's deals, open first and newest first", () => {
    const leads = [
      lead("a", "c1", "won", "2026-09-01"),
      lead("b", "c1", "new", "2026-08-01"),
      lead("c", "c2", "new", "2026-10-01"),
      lead("d", "c1", "lost", "2026-10-05"),
      lead("e", "c1", "new", "2026-10-02")
    ];
    expect(dealsForClient(leads, "c1", stages).map(l => l.id)).toEqual(["e", "b", "a", "d"]);
  });
});
