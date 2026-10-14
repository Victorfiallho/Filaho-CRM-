import { apiFetch } from "../lib/apiFetch";

export interface JobAiSummary {
  summary: string;
  next_step: string;
}

// Calls web/api/summarize-job.js, which checks the caller's company, reads
// the job's notes and asks Groq for the current state and a next step.
export function summarizeJob(jobId: string): Promise<JobAiSummary> {
  return apiFetch<JobAiSummary>("/api/summarize-job", { job_id: jobId }, "Failed to summarize.");
}
