import { supabase } from "../lib/supabaseClient";

export interface JobAiSummary {
  summary: string;
  next_step: string;
}

// Calls web/api/summarize-job.js, which checks the caller's company, reads
// the job's notes and asks Groq for the current state and a next step.
export async function summarizeJob(jobId: string): Promise<JobAiSummary> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  const res = await fetch("/api/summarize-job", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ job_id: jobId })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to summarize.");
  return res.json();
}
