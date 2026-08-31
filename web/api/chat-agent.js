// Vercel serverless function backing the global "Assistente" chat widget
// (web/src/components/ChatWidget.tsx). A read-only support agent scoped to
// the caller's active company — never a general-purpose assistant with raw
// DB access.
//
// Runs on Groq (free tier, OpenAI-compatible chat completions API) —
// switched from Gemini after Google AI Studio started issuing "AQ."-prefixed
// keys that 401 with ACCESS_TOKEN_TYPE_UNSUPPORTED on generativelanguage.
// googleapis.com (a known, unresolved Google-side bug as of 2026-08-31, not
// something fixable in this codebase). Model: openai/gpt-oss-20b — Groq's
// fastest model with tool-calling support and the highest free-tier rate
// limits (250K tokens/min, 1K requests/min).
//
// SECURITY MODEL (read this before adding a tool):
// The client sends `company_id`, but it is only ever used AFTER being
// checked against the caller's real `company_members` rows below — never
// trusted on its own. Every tool handler receives that already-verified
// `companyId` as a plain JS argument from server-side code, NOT as a
// parameter the model's tool-calling can supply — the tool declarations
// exposed to the model (TOOLS below) never include company_id/company/
// tenant in their parameter schema. This means even if a prompt-injection
// attempt buried in a note or a lead's name tried to convince the model to
// "call search_jobs for company X", there is no argument path for the model
// to change which company's data gets queried; only the verified session's
// own company can ever be read. All tools are SELECT-only (no insert/
// update/delete anywhere in this file) — this agent cannot take actions on
// data, only report on it, matching the read-only decision made for this
// feature.
import { createClient } from "@supabase/supabase-js";

const GROQ_MODEL = "openai/gpt-oss-20b";
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_TURNS = 10;
const MAX_MESSAGE_LENGTH = 2000;

const SYSTEM_INSTRUCTION =
  "Você é o assistente de suporte da Filaho Home Improvement, um CRM para empresas de reformas. " +
  "Responda sempre em português do Brasil, de forma direta e objetiva. " +
  "Use as ferramentas disponíveis sempre que a pergunta envolver dados reais da empresa (leads, clientes, jobs, funil, campanhas) — " +
  "nunca invente números. Se não tiver certeza ou a ferramenta não cobrir o que foi perguntado, diga isso claramente. " +
  "Você é somente leitura: não pode criar, editar ou apagar nada — se pedirem uma ação, explique que só consegue consultar informações " +
  "e sugira onde na plataforma a pessoa pode fazer isso manualmente.";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_company_overview",
      description: "Contagens gerais da empresa ativa: clientes, leads, valor total em pipeline, jobs, receita fechada e leads estagnados.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_pipeline_funnel",
      description: "Funil de vendas por estágio do pipeline: quantidade de leads, taxa de conversão, tempo médio no estágio, valor total e forecast ponderado.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_stagnant_leads",
      description: "Lista de leads parados há muito tempo no mesmo estágio do pipeline (negócios estagnados).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_campaign_roi",
      description: "ROI de campanhas de anúncio (Meta Ads) num período: custo, receita atribuída, ROAS e CPL por campanha.",
      parameters: {
        type: "object",
        properties: { days: { type: "integer", description: "Quantos dias para trás considerar. Padrão 90 se não informado." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_customers",
      description: "Busca clientes da empresa pelo nome.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de busca no nome do cliente. Deixe vazio para ver os mais recentes." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_leads",
      description: "Busca leads (oportunidades no pipeline) pelo nome.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Termo de busca no nome do lead. Deixe vazio para ver os mais recentes." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_jobs",
      description: "Busca jobs/projetos pelo título, opcionalmente filtrando por status.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca no título do job. Deixe vazio para ver os mais recentes." },
          status: { type: "string", description: "Filtrar por status exato: planned, scheduled, in progress ou complete." }
        }
      }
    }
  }
];

async function toolGetCompanyOverview(supabase, companyId) {
  const [{ count: customersCount }, { data: leads }, { data: jobs }, { data: stagnantLeads }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    supabase.from("leads").select("value").eq("company_id", companyId),
    supabase.from("jobs").select("status, estimated_value").eq("company_id", companyId),
    supabase.rpc("get_stagnant_leads", { p_company_id: companyId })
  ]);
  const totalPipelineValue = (leads || []).reduce((t, l) => t + Number(l.value || 0), 0);
  const closedRevenue = (jobs || []).filter(j => j.status === "complete").reduce((t, j) => t + Number(j.estimated_value || 0), 0);
  return {
    customers_count: customersCount || 0,
    leads_count: (leads || []).length,
    total_pipeline_value: totalPipelineValue,
    jobs_count: (jobs || []).length,
    closed_revenue: closedRevenue,
    stagnant_leads_count: (stagnantLeads || []).length
  };
}

async function toolGetPipelineFunnel(supabase, companyId) {
  const { data, error } = await supabase.rpc("get_funnel_summary", { p_company_id: companyId, p_date_from: null, p_date_to: null });
  if (error) throw error;
  return data;
}

async function toolGetStagnantLeads(supabase, companyId) {
  const { data, error } = await supabase.rpc("get_stagnant_leads", { p_company_id: companyId });
  if (error) throw error;
  return data;
}

async function toolGetCampaignRoi(supabase, companyId, args) {
  const days = Math.min(365, Math.max(1, Number(args?.days) || 90));
  const dateTo = new Date().toISOString();
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.rpc("get_campaign_roi", { p_company_id: companyId, p_date_from: dateFrom, p_date_to: dateTo });
  if (error) throw error;
  return data;
}

async function toolSearchCustomers(supabase, companyId, args) {
  const q = String(args?.query || "").trim();
  let query = supabase
    .from("customers")
    .select("id, name, phone, email, status, service_type, city")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function toolSearchLeads(supabase, companyId, args) {
  const q = String(args?.query || "").trim();
  let query = supabase
    .from("leads")
    .select("id, name, stage_id, value, service_type, updated_at")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function toolSearchJobs(supabase, companyId, args) {
  const q = String(args?.query || "").trim();
  let query = supabase
    .from("jobs")
    .select("id, title, customer_name, status, scheduled_date, estimated_value")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (q) query = query.ilike("title", `%${q}%`);
  if (args?.status) query = query.eq("status", String(args.status));
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const TOOL_HANDLERS = {
  get_company_overview: toolGetCompanyOverview,
  get_pipeline_funnel: toolGetPipelineFunnel,
  get_stagnant_leads: toolGetStagnantLeads,
  get_campaign_roi: toolGetCampaignRoi,
  search_customers: toolSearchCustomers,
  search_leads: toolSearchLeads,
  search_jobs: toolSearchJobs
};

async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured on the server.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: GROQ_MODEL, messages, tools: TOOLS, tool_choice: "auto" })
  });
  if (!res.ok) throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const { company_id: requestedCompanyId, message, history } = req.body || {};
  const trimmedMessage = String(message || "").slice(0, MAX_MESSAGE_LENGTH).trim();
  if (!requestedCompanyId || !trimmedMessage) {
    res.status(400).json({ error: "Missing company_id or message." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }

    const { data: memberRows } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id);
    const companyIds = (memberRows || []).map(r => r.company_id);
    // The one and only place company_id is checked — everything downstream
    // (every tool call) uses this already-verified `companyId`, never the
    // raw `requestedCompanyId` again.
    if (!companyIds.includes(requestedCompanyId)) {
      res.status(403).json({ error: "You are not a member of that company." });
      return;
    }
    const companyId = requestedCompanyId;

    const priorTurns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const messages = [{ role: "system", content: SYSTEM_INSTRUCTION }];
    for (const t of priorTurns) {
      if (t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") {
        messages.push({ role: t.role, content: t.text.slice(0, MAX_MESSAGE_LENGTH) });
      }
    }
    messages.push({ role: "user", content: trimmedMessage });

    let reply = "";
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const body = await callGroq(messages);
      const assistantMessage = body?.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls || [];

      if (!toolCalls.length) {
        reply = (assistantMessage?.content || "").trim();
        break;
      }

      messages.push({ role: "assistant", content: assistantMessage.content || null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        const toolHandler = TOOL_HANDLERS[call.function?.name];
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          // malformed arguments from the model — fall through with {} args
        }
        let result;
        try {
          result = toolHandler ? await toolHandler(supabase, companyId, args) : { error: "Unknown tool." };
        } catch (err) {
          result = { error: err.message };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    if (!reply) reply = "Não consegui montar uma resposta agora — tenta reformular a pergunta?";
    res.status(200).json({ reply });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
