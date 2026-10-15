// "AI summary" on a job: reads its notes and asks Groq (gpt-oss-20b) for
// the current state and a next step.
//
// The job must belong to one of the caller's companies before any note is
// read. The service_role client bypasses RLS, so this check is the guard.
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
            'You are a CRM assistant for a home improvement company. Respond STRICTLY in valid JSON, ' +
            'in the format {"summary": "...", "next_step": "..."}. Nothing but the JSON, no markdown.'
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
      .select("id, company_id, title, status, service_type, scheduled_date, estimated_value, customer_name")
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
      .eq("company_id", job.company_id)
      .eq("entity_type", "job")
      .eq("entity_id", jobId)
      .order("created_at", { ascending: true });

    const noteHistory = (notes || []).length
      ? notes.map(n => `[${new Date(n.created_at).toLocaleDateString("en-US")}] ${n.body}`).join("\n")
      : "(no notes logged yet)";

    const jobSummary = [
      `Title: ${job.title}`,
      `Customer: ${job.customer_name || "not provided"}`,
      `Status: ${job.status}`,
      `Service: ${job.service_type || "not provided"}`,
      `Scheduled date: ${job.scheduled_date || "not scheduled"}`,
      `Estimated value: ${job.estimated_value || 0}`
    ].join("\n");

    const prompt =
      "You are a CRM assistant for a home improvement company. " +
      "Always respond in English, directly and objectively, in at most 3 sentences per field.\n\n" +
      `Job data:\n${jobSummary}\n\nNote history:\n${noteHistory}\n\n` +
      "Based on this, fill in: summary (current state of the deal) and next_step (recommended next step).";

    const parsed = await callGroq(prompt);
    res.status(200).json({ summary: parsed.summary || "", next_step: parsed.next_step || "" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
