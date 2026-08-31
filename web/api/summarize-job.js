// Vercel serverless function (web/api/* is Vercel's zero-config function
// folder for this project's Root Directory) — backs RecordModal's "Resumo
// com IA" button on a job's detail view. Reads that job's notes and asks
// an LLM for a PT-BR "current state + recommended next step" summary.
//
// Runs on Groq (free tier, OpenAI-compatible chat completions API) —
// switched from Gemini after Google AI Studio started issuing "AQ."-prefixed
// keys that 401 with ACCESS_TOKEN_TYPE_UNSUPPORTED on generativelanguage.
// googleapis.com (a known, unresolved Google-side bug as of 2026-08-31, not
// something fixable in this codebase). Model: openai/gpt-oss-20b — Groq's
// fastest model with the highest free-tier rate limits.
//
// Same auth shape as web/api/send-notification.js: requires a valid Supabase
// session, then — instead of that endpoint's "known contact" check — verifies
// the job itself belongs to a company the caller is a member of before
// touching any of its notes. Without this check, any authenticated user of
// ANY company could pass an arbitrary job_id and read another tenant's
// customer notes through this endpoint, bypassing RLS (which the
// service_role client below doesn't enforce on its own).
import { createClient } from "@supabase/supabase-js";

const GROQ_MODEL = "openai/gpt-oss-20b";

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured on the server.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Você é um assistente de CRM para uma empresa de reformas/home improvement. Responda ESTRITAMENTE em JSON válido ' +
            'no formato {"summary": "...", "next_step": "..."} — nada além do JSON, sem markdown.'
        },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq did not return a response.");
  return JSON.parse(text);
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

  const { job_id: jobId } = req.body || {};
  if (!jobId) {
    res.status(400).json({ error: "Missing job_id." });
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
    if (!companyIds.length) {
      res.status(403).json({ error: "No company membership." });
      return;
    }

    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, status, service_type, scheduled_date, estimated_value, customer_name")
      .eq("id", jobId)
      .in("company_id", companyIds)
      .maybeSingle();
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return;
    }

    const { data: notes } = await supabase
      .from("notes")
      .select("body, created_at")
      .eq("entity_type", "job")
      .eq("entity_id", jobId)
      .order("created_at", { ascending: true });

    const noteHistory = (notes || []).length
      ? notes.map(n => `[${new Date(n.created_at).toLocaleDateString("pt-BR")}] ${n.body}`).join("\n")
      : "(nenhuma nota registrada ainda)";

    const jobSummary = [
      `Título: ${job.title}`,
      `Cliente: ${job.customer_name || "não informado"}`,
      `Status: ${job.status}`,
      `Serviço: ${job.service_type || "não informado"}`,
      `Data agendada: ${job.scheduled_date || "não agendada"}`,
      `Valor estimado: ${job.estimated_value || 0}`
    ].join("\n");

    const prompt =
      "Você é um assistente de CRM para uma empresa de reformas/home improvement. " +
      "Responda sempre em português do Brasil, de forma direta e objetiva, em no máximo 3 frases por campo.\n\n" +
      `Dados do job:\n${jobSummary}\n\nHistórico de notas:\n${noteHistory}\n\n` +
      "Com base nisso, preencha: summary (estado atual do negócio) e next_step (próximo passo recomendado).";

    const parsed = await callGroq(prompt);
    res.status(200).json({ summary: parsed.summary || "", next_step: parsed.next_step || "" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
