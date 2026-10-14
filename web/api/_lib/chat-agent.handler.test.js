// The assistant's request loop with Supabase and Groq faked: membership
// check, prompt context, tool dispatch on the verified company's rows, and
// the fallback model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tables = {
  company_members: [{ user_id: "u-auth", company_id: "wish" }],
  companies: [{ id: "wish", name: "Wish Cabinets" }],
  pipeline_stages: [{ id: "new", company_id: "wish", name: "New", type: "open", order: 1 }, { id: "won", company_id: "wish", name: "Won", type: "won", order: 2 }],
  company_services: [{ company_id: "wish", service: "Kitchen Cabinets", position: 0 }],
  customers: [{ id: "c1", company_id: "wish", name: "Bob Lee" }, { id: "cx", company_id: "other", name: "Not mine" }],
  leads: [
    { id: "l1", company_id: "wish", customer_id: "c1", name: "Bob Lee", stage_id: "won", value: 9800 },
    { id: "l2", company_id: "wish", customer_id: "c1", name: "Bob Lee", title: "Bathroom", stage_id: "new", value: 6400 },
    { id: "lx", company_id: "other", customer_id: "cx", name: "Not mine", stage_id: "new" },
    { id: "ly", company_id: "other", customer_id: "cx", name: "Not mine", stage_id: "new" }
  ],
  jobs: [],
  users: [],
  notes: []
};

function builder(table) {
  const filters = [];
  const self = {
    select: () => self,
    eq: (col, val) => { filters.push(r => r[col] === val); return self; },
    in: (col, vals) => { filters.push(r => vals.includes(r[col])); return self; },
    order: () => self,
    limit: () => self,
    maybeSingle: async () => ({ data: (tables[table] || []).filter(r => filters.every(f => f(r)))[0] || null, error: null }),
    then: resolve => resolve({ data: (tables[table] || []).filter(r => filters.every(f => f(r))), error: null })
  };
  return self;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: table => builder(table),
    rpc: async () => ({ data: [], error: null }),
    auth: { getUser: async token => (token === "good" ? { data: { user: { id: "u-auth" } }, error: null } : { data: { user: null }, error: new Error("bad") }) }
  })
}));

const { default: handler } = await import("../chat-agent.js");

let groqCalls;
let groqScript;
beforeEach(() => {
  process.env.GROQ_API_KEY = "test";
  groqCalls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    groqCalls.push(body);
    const step = groqScript.shift();
    if (step.status) return { ok: false, status: step.status, text: async () => "rate limited", json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: step }] }) };
  });
});
afterEach(() => vi.unstubAllGlobals());

async function call(body, token = "good") {
  const res = { statusCode: 200, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.body = obj; return res; };
  await handler({ method: "POST", headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}

const toolCall = (name, args) => ({ content: null, tool_calls: [{ id: "t1", type: "function", function: { name, arguments: JSON.stringify(args) } }] });

describe("chat-agent", () => {
  it("runs a tool on the verified company's rows and returns the final answer", async () => {
    groqScript = [toolCall("find_clients", { min_deals: 2 }), { content: "**1** client: [Bob Lee](client:c1)" }];
    const res = await call({ company_id: "wish", message: "quais clientes têm mais de um negócio?", lang: "pt" });
    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toBe("**1** client: [Bob Lee](client:c1)");

    const toolResult = JSON.parse(groqCalls[1].messages.at(-1).content);
    expect(toolResult.results.map(c => c.name)).toEqual(["Bob Lee"]); // never the other company's client
    const system = groqCalls[0].messages[0].content;
    expect(system).toContain("Wish Cabinets");
    expect(system).toContain("Brazilian Portuguese");
    expect(system).toMatch(/Today is \w+day, \d{4}-\d{2}-\d{2}/);
    expect(system).toContain("New (open), Won (won)");
    expect(groqCalls[0].model).toBe("openai/gpt-oss-120b");
  });

  it("falls back to the smaller model when the bigger one is rate-limited", async () => {
    groqScript = [{ status: 429 }, { content: "ok" }];
    const res = await call({ company_id: "wish", message: "oi", lang: "pt" });
    expect(res.body.reply).toBe("ok");
    expect(groqCalls.map(c => c.model)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("refuses a company the user isn't a member of, and a bad session", async () => {
    groqScript = [];
    expect((await call({ company_id: "other", message: "hi" })).statusCode).toBe(403);
    expect((await call({ company_id: "wish", message: "hi" }, "bad")).statusCode).toBe(401);
    expect(groqCalls).toHaveLength(0);
  });

  it("no tool can be pointed at another company", async () => {
    groqScript = [toolCall("get_record", { ref: "client:cx" }), { content: "done" }];
    await call({ company_id: "wish", message: "show cx" });
    expect(JSON.parse(groqCalls[1].messages.at(-1).content)).toEqual({ error: "Client not found." });
  });
});
