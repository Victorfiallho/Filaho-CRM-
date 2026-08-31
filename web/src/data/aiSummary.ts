import { supabase } from "../lib/supabaseClient";

export interface JobAiSummary {
  summary: string;
  next_step: string;
}

// Calls web/api/summarize-job.js, which reads the job's notes server-side
// (after checking the caller belongs to the job's company) and asks Groq
// (free tier) for a PT-BR "current state + recommended next step" — same
// Bearer-token auth pattern as web/api/send-notification.js.
export async function summarizeJob(jobId: string): Promise<JobAiSummary> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");
  const res = await fetch("/api/summarize-job", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ job_id: jobId })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to summarize.");
  return res.json();
}
