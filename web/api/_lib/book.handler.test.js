// End-to-end through the real handler with Supabase faked: what the visitor
// gets back, and exactly what reaches submit_booking().
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { page: null, company: null, services: [], versions: [], recentCount: 0, rpcCalls: [], rpcError: null };

function builder(table) {
  const filters = {};
  const self = {
    select: () => self,
    eq: (col, val) => { filters[col] = val; return self; },
    gte: () => self,
    order: () => self,
    maybeSingle: async () => {
      if (table === "booking_pages") {
        const p = state.page;
        const hit = p && (filters.slug === p.slug || filters.company_id === p.company_id);
        return { data: hit ? p : null, error: null };
      }
      if (table === "companies") return { data: state.company, error: null };
      if (table === "consent_text_versions") {
        return { data: state.versions.find(v => v.kind === filters.kind && v.version === filters.version) || null, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve) => {
      if (table === "booking_requests") return resolve({ count: state.recentCount, error: null });
      if (table === "consent_text_versions") return resolve({ data: [...state.versions].sort((a, b) => b.version - a.version), error: null });
      if (table === "company_services") return resolve({ data: state.services, error: null });
      return resolve({ data: [], error: null });
    }
  };
  return self;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: table => builder(table),
    rpc: async (name, args) => { state.rpcCalls.push({ name, args }); return { data: {}, error: state.rpcError }; },
    auth: { getUser: async () => ({ data: { user: null }, error: new Error("no") }) }
  })
}));

const { default: handler } = await import("../book.js");

function makeReq({ method = "GET", url, body, headers = {} }) {
  return { method, url, body, headers: { host: "crm.test", "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test", ...headers } };
}

function makeRes() {
  const res = { statusCode: 200, headers: {}, body: "" };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.body = JSON.stringify(obj); return res; };
  res.end = (b = "") => { res.body = b; return res; };
  return res;
}

async function call(opts) {
  const res = makeRes();
  await handler(makeReq(opts), res);
  return res;
}

const validBody = {
  first_name: "Jane", last_name: "Doe", phone: "(404) 555-0123", email: "jane@example.com",
  address: "10 Oak St", city: "Marietta", zip: "30062", services: ["deep-cleaning"],
  sms_text_version: "1", email_text_version: "1", transactional_text_version: "1", utm_source: "google"
};

beforeEach(() => {
  state.page = {
    company_id: "peach_fresh", slug: "peach-fresh", active: true, business_name: "Peach Fresh", hero_title: "", hero_subtitle: "",
    primary_color: "#f36f45", logo_url: "", phone: "(404) 555-0100", email: "hi@example.com", address_line: "1 Main St",
    address_city: "Marietta", address_state: "GA", address_zip: "30060", service_cities: ["Marietta"], zip_prefixes: ["300"],
    services: [{ id: "carpet", name: "Carpet cleaning", position: 0, active: true }], faq: [], reviews: [], seo_title: "", seo_description: "", updated_at: "2026-10-13T00:00:00Z"
  };
  state.company = { id: "peach_fresh", name: "Peach Fresh Cleaning", color: "#f36f45" };
  state.services = [{ service: "Deep Cleaning", position: 0 }, { service: "Move-in/Move-out", position: 1 }];
  state.versions = [
    { kind: "sms", version: 1, template: "SMS v1 from {Business}. See our SMS Terms and Privacy Policy." },
    { kind: "sms", version: 2, template: "SMS v2 from {Business}." },
    { kind: "email", version: 1, template: "Email v1." },
    { kind: "transactional", version: 1, template: "By booking, you agree..." }
  ];
  state.recentCount = 0;
  state.rpcCalls = [];
  state.rpcError = null;
});

describe("GET /book/<slug>", () => {
  it("renders the latest consent texts with a hash-based CSP and no secrets", async () => {
    const res = await call({ url: "/api/book?slug=peach-fresh" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("SMS v2 from Peach Fresh Cleaning.");
    expect(res.headers["content-security-policy"]).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(res.body).not.toMatch(/service_role|SUPABASE|supabase\.co|eyJ/i);
  });

  it("is live without any activation, built from the company and its CRM services", async () => {
    state.page.active = false; // the flag no longer matters
    const res = await call({ url: "/api/book?slug=peach-fresh" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Peach Fresh Cleaning");
    expect(res.body).toContain('value="deep-cleaning"');
    expect(res.body).toContain('value="move-in-move-out"');
    expect(res.body).not.toContain("Carpet cleaning"); // the old per-page list is ignored
  });

  it("404s an unknown slug", async () => {
    expect((await call({ url: "/api/book?slug=nope" })).statusCode).toBe(404);
  });

  it("serves the two legal pages", async () => {
    expect((await call({ url: "/api/book?slug=peach-fresh&page=sms-terms" })).body).toContain("Mobile information will not be shared");
    expect((await call({ url: "/api/book?slug=peach-fresh&page=privacy" })).body).toContain("Privacy Policy");
  });

  it("allows the web font and nothing else external", async () => {
    const csp = (await call({ url: "/api/book?slug=peach-fresh" })).headers["content-security-policy"];
    expect(csp).toContain("font-src https://fonts.gstatic.com");
    expect(csp.match(/'sha256-/g)).toHaveLength(2);
    expect(csp).toContain("default-src 'none'");
  });
});

describe("POST /book/<slug>", () => {
  it("submits one booking with both consent records, the shown text version, and server-side IP/UA", async () => {
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: validBody });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("https://crm.test/book/peach-fresh?booked=Jane#booked");

    expect(state.rpcCalls).toHaveLength(1);
    const { name, args: { p } } = state.rpcCalls[0];
    expect(name).toBe("submit_booking");
    expect(p).toMatchObject({
      company_id: "peach_fresh", name: "Jane Doe", phone: "(404) 555-0123", phone_e164: "+14045550123",
      services: ["Deep Cleaning"], ip: "203.0.113.7", user_agent: "Mozilla/5.0 test", page_url: "https://crm.test/book/peach-fresh",
      utm: expect.objectContaining({ utm_source: "google" })
    });
    expect(p.consents).toEqual([
      // the form was rendered with v1 (hidden field) → v1's exact text is recorded, not the newer v2
      { channel: "sms", value: "+14045550123", granted: false, text_shown: "SMS v1 from Peach Fresh Cleaning. See our SMS Terms and Privacy Policy.", text_version: 1 },
      { channel: "email", value: "jane@example.com", granted: false, text_shown: "Email v1.", text_version: 1 }
    ]);
    expect(p).not.toHaveProperty("created_at");
  });

  it("records granted=true only for the box that was checked", async () => {
    await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: { ...validBody, sms_consent: "yes" } });
    expect(state.rpcCalls[0].args.p.consents.map(c => [c.channel, c.granted])).toEqual([["sms", true], ["email", false]]);
  });

  it("falls back to the latest version when the form's version doesn't exist", async () => {
    await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: { ...validBody, sms_text_version: "99" } });
    expect(state.rpcCalls[0].args.p.consents[0]).toMatchObject({ text_version: 2, text_shown: "SMS v2 from Peach Fresh Cleaning." });
  });

  it("fakes success for bots that fill the honeypot, saving nothing", async () => {
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: { ...validBody, website: "http://spam" } });
    expect(res.statusCode).toBe(303);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("takes a ZIP from anywhere, no service-area filter", async () => {
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: { ...validBody, zip: "90210" } });
    expect(res.statusCode).toBe(303);
    expect(state.rpcCalls[0].args.p).toMatchObject({ zip: "90210", state: "CA" });
  });

  it("re-renders with errors and the typed values for a malformed ZIP", async () => {
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: { ...validBody, zip: "123" } });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("Please enter a 5-digit ZIP code.");
    expect(res.body).toContain('value="10 Oak St"');
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("rate-limits per IP", async () => {
    state.recentCount = 5;
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: validBody });
    expect(res.statusCode).toBe(429);
    expect(state.rpcCalls).toHaveLength(0);
    expect(res.body).toContain('value="Jane"');
  });

  it("keeps the visitor's answers and shows the phone when saving fails", async () => {
    state.rpcError = { message: "boom" };
    const res = await call({ method: "POST", url: "/api/book?slug=peach-fresh", body: validBody });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain("wasn&#39;t saved");
    expect(res.body).toContain('value="jane@example.com"');
    expect(res.body).toContain('href="tel:4045550100"');
  });
});
