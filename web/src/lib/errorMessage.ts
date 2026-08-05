// Supabase's PostgrestError (and auth errors) are plain objects shaped like
// an Error — { message, details, hint, code } — but aren't `instanceof Error`,
// so `error instanceof Error ? error.message : fallback` silently swallows
// them and always shows the fallback. This checks for a `.message` string on
// anything error-shaped before giving up and using the fallback.
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}
