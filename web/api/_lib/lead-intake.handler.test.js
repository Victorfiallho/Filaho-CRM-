// Through the real handler with Supabase faked: auth, client matching, one
// deal per service, and what gets inserted.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { company: null, stages: [], services: [], customers: [], leads: [], inserts: [] };

function builder(table) {
  const filters = {};
  let pending = null;
  const rows = () => {
    if (table === "pipeline_stages") return state.stages;
    if (table === "company_services") return state.services;
    if (table === "customers") return state.customers;
    if (table === "leads") return state.leads.filter(l => Object.entries(filters).every(([k, v]) => l[k] === v));
    return [];
  };
  const self = {
    select: () => self,
    eq: (col, val) => { filters[col] = val; return self; },
    order: () => self,
    limit: () => self,
    insert: row => { pending = row; state.inserts.push({ table, row }); return self; },
    single: async () => ({ data: pending, error: null }),
    maybeSingle: async () => {
      if (table === "companies") return { data: state.company, error: null };
      return { data: rows()[0] || null, error: null };
    },
    then: resolve => resolve(pending ? { error: null } : { data: rows(), error: null })
  };
  return self;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: table => builder(table) }) }));

const { default: handler } = await import("../lead-intake.js");

async function call({ method = "POST", url = "/api/lead-intake?company=wish&key=s3cret", body = {} } = {}) {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.body = obj; return res; };
  await handler({ method, url, body, headers: {} }, res);
  return res;
}

const inserted = table => state.inserts.filter(i => i.table === table).map(i => i.row);

beforeEach(() => {
  process.env.LEAD_INTAKE_SECRET = "s3cret";
  state.company = { id: "wish" };
  state.stages = [{ id: "new", order: 1, type: "open" }, { id: "won", order: 5, type: "won" }];
  state.services = [{ service: "Kitchen Cabinets", position: 1 }];
  state.customers = [];
  state.leads = [];
  state.inserts = [];
});

describe("lead-intake handler", () => {
  it("refuses a wrong key, and everything when the secret is unset", async () => {
    expect((await call({ url: "/api/lead-intake?company=wish&key=nope" })).statusCode).toBe(401);
    delete process.env.LEAD_INTAKE_SECRET;
    expect((await call()).statusCode).toBe(401);
  });

  it("rejects a lead without a usable phone or email", async () => {
    expect((await call({ body: { full_name: "Jane" } })).statusCode).toBe(422);
  });

  it("returns 404 for an unknown company", async () => {
    state.company = null;
    expect((await call({ body: { full_name: "Jane", email: "jane@x.com" } })).statusCode).toBe(404);
  });

  it("creates a client and a tagged deal, with extra answers as a note", async () => {
    const res = await call({ body: {
      full_name: "Jane Doe", phone_number: "512-555-0134", service: "kitchen cabinets",
      campaign_id: "c1", campaign_name: "Fall", budget: "$20k"
    } });
    expect(res.statusCode).toBe(201);
    expect(inserted("customers")[0]).toMatchObject({ company_id: "wish", name: "Jane Doe", phone_e164: "+15125550134", service_type: "Kitchen Cabinets", source: "Meta Ads" });
    expect(inserted("leads")[0]).toMatchObject({ stage_id: "new", service_type: "Kitchen Cabinets", campaign_id: "c1", campaign_name: "Fall" });
    expect(inserted("notes")[0]).toMatchObject({ entity_type: "lead", body: "budget: $20k" });
  });

  it("reuses an existing client and doesn't duplicate a deal for the same service", async () => {
    state.customers = [{ id: "cust_1", phone: "(512) 555-0134", email: "", service_type: "Kitchen Cabinets" }];
    state.leads = [{ id: "lead_1", company_id: "wish", customer_id: "cust_1", service_type: "Kitchen Cabinets" }];
    const res = await call({ body: { full_name: "Jane", phone: "5125550134", service: "Kitchen Cabinets" } });
    expect(res.body).toMatchObject({ lead_id: "lead_1", existing_client: true, new_deal: false });
    expect(inserted("customers")).toHaveLength(0);
    expect(inserted("leads")).toHaveLength(0);
  });

  it("adds a deal for an existing client asking for a new service", async () => {
    state.services.push({ service: "Bathroom Vanity", position: 2 });
    state.customers = [{ id: "cust_1", phone: "", email: "jane@x.com", service_type: "Kitchen Cabinets" }];
    state.leads = [{ id: "lead_1", company_id: "wish", customer_id: "cust_1", service_type: "Kitchen Cabinets" }];
    const res = await call({ body: { full_name: "Jane", email: "jane@x.com", service: "Bathroom Vanity" } });
    expect(res.statusCode).toBe(201);
    expect(inserted("leads")[0]).toMatchObject({ customer_id: "cust_1", service_type: "Bathroom Vanity" });
  });

  it("keeps an unmatched service text in the note", async () => {
    await call({ body: { full_name: "Jane", email: "jane@x.com", service: "Roofing" } });
    expect(inserted("leads")[0].service_type).toBe("");
    expect(inserted("notes")[0].body).toBe("Service asked: Roofing");
  });
});
