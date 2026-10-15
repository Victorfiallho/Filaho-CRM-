// /api/messages and inbound SMS routing, with Supabase, Twilio and Resend
// faked: who may send, where it goes, and what gets stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {};
const users = { "tok-alice": "alice" };

function builder(table) {
  const filters = [];
  let op = "select", payload = null, countOnly = false, order = null, lim = null;
  const rows = () => (db[table] || []).filter(r => filters.every(f => f(r)));
  const result = () => {
    let r = rows();
    if (order) r = [...r].sort((a, b) => (order.asc ? 1 : -1) * String(a[order.col]).localeCompare(String(b[order.col])));
    if (lim) r = r.slice(0, lim);
    return r;
  };
  const self = {
    select: (_c, opts) => { if (opts?.head) countOnly = true; return self; },
    eq: (c, v) => { filters.push(r => r[c] === v); return self; },
    gte: (c, v) => { filters.push(r => r[c] >= v); return self; },
    order: (col, o) => { order = { col, asc: o?.ascending !== false }; return self; },
    limit: n => { lim = n; return self; },
    insert: row => { op = "insert"; payload = row; (db[table] ||= []).push({ created_at: new Date().toISOString(), ...row }); return self; },
    single: async () => ({ data: op === "insert" ? db[table][db[table].length - 1] : result()[0] || null, error: null }),
    maybeSingle: async () => ({ data: result()[0] || null, error: null }),
    then: resolve => resolve(countOnly ? { count: rows().length, error: null } : { data: result(), error: null })
  };
  return self;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: table => builder(table),
    auth: { getUser: async token => (users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: null, error: new Error("bad") }) }
  })
}));

const { default: handler } = await import("../messages.js");
const { routeInboundSms } = await import("./messaging.js");
const { createClient } = await import("@supabase/supabase-js");

async function call({ method = "POST", token = "tok-alice", body = {}, url = "/api/messages" } = {}) {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.body = obj; return res; };
  await handler({ method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
  return res;
}

const send = (over = {}) => call({ body: { company_id: "A", customer_id: "c1", channel: "sms", body: "Hi!", ...over } });
let fetchMock;

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    company_members: [{ user_id: "alice", company_id: "A" }],
    companies: [{ id: "A", name: "Wish Cabinets" }, { id: "B", name: "Peach Fresh" }],
    company_messaging: [{ company_id: "A", sms_from: "+14045550000", email_from: "Wish <hi@wish.test>", email_reply_to: "" }],
    booking_pages: [{ company_id: "A", email: "office@wish.test" }],
    customers: [
      { id: "c1", company_id: "A", name: "Jane", phone: "(404) 555-0134", phone_e164: "+14045550134", email: "jane@x.com" },
      { id: "c2", company_id: "A", name: "No Contact", phone: "", phone_e164: null, email: "" },
      { id: "cB", company_id: "B", name: "Other Co", phone: "(404) 555-0199", phone_e164: "+14045550199", email: "o@x.com" }
    ],
    suppression_list: [],
    messages: []
  });
  process.env.TWILIO_ACCOUNT_SID = "AC1";
  process.env.TWILIO_AUTH_TOKEN = "t";
  process.env.RESEND_API_KEY = "re";
  fetchMock = vi.fn(async url => ({ ok: true, json: async () => (String(url).includes("twilio") ? { sid: "SM1" } : { id: "em1" }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/messages", () => {
  it("needs a session and membership of the company", async () => {
    expect((await call({ token: null })).statusCode).toBe(401);
    expect((await send({ company_id: "B" })).statusCode).toBe(403);
  });

  it("texts the client's own number from the company's number and stores it", async () => {
    const res = await send();
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("api.twilio.com");
    expect(String(init.body)).toContain("To=%2B14045550134");
    expect(String(init.body)).toContain("From=%2B14045550000");
    expect(db.messages[0]).toMatchObject({ company_id: "A", customer_id: "c1", direction: "out", status: "sent", provider_id: "SM1", sent_by: "alice" });
  });

  it("emails with the company's sender and the booking page email as reply-to", async () => {
    await send({ channel: "email", subject: "Your quote", body: "Attached." });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ from: "Wish <hi@wish.test>", to: ["jane@x.com"], reply_to: "office@wish.test", subject: "Your quote" });
  });

  it("never takes the address from the request and won't reach another company's client", async () => {
    await send({ to: "+19999999999" });
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("To=%2B14045550134");
    expect((await send({ customer_id: "cB" })).statusCode).toBe(404);
  });

  it("refuses numbers that replied STOP, clients without the channel, and unconfigured channels", async () => {
    db.suppression_list.push({ channel: "sms", value: "+14045550134" });
    expect((await send()).statusCode).toBe(409);
    expect((await send({ customer_id: "c2" })).statusCode).toBe(422);
    db.company_messaging[0].sms_from = "";
    delete process.env.TWILIO_FROM_NUMBER;
    expect((await send()).body.code).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores a failed send with the provider's error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: "Invalid To number" }) });
    const res = await send();
    expect(res.statusCode).toBe(502);
    expect(db.messages[0]).toMatchObject({ status: "failed", error: "Invalid To number" });
  });

  it("rate limits each person", async () => {
    for (let i = 0; i < 20; i++) db.messages.push({ id: `m${i}`, sent_by: "alice", created_at: new Date().toISOString() });
    expect((await send()).statusCode).toBe(429);
  });

  it("GET reports which channels are set up", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await call({ method: "GET", url: "/api/messages?company_id=A" });
    expect(res.body).toEqual({ sms: true, email: false });
  });
});

describe("routeInboundSms", () => {
  const supabase = () => createClient();

  it("uses the company whose number was texted", async () => {
    expect(await routeInboundSms(supabase(), { from: "+14045550134", to: "+14045550000" })).toEqual({ companyId: "A", customerId: "c1" });
  });

  it("otherwise the company that last texted this person", async () => {
    db.messages.push({ channel: "sms", direction: "out", to_addr: "+14045550199", company_id: "B", created_at: "2026-10-01" });
    expect(await routeInboundSms(supabase(), { from: "+14045550199", to: "+15550000000" })).toEqual({ companyId: "B", customerId: "cB" });
  });

  it("otherwise the only company that has them as a client, else nothing", async () => {
    expect(await routeInboundSms(supabase(), { from: "+14045550199", to: "" })).toEqual({ companyId: "B", customerId: "cB" });
    expect(await routeInboundSms(supabase(), { from: "+12125550100", to: "" })).toBeNull();
  });
});
