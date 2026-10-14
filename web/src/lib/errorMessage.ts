// Supabase errors are plain objects with a `message`, not Error instances,
// so `instanceof Error` would always fall back. Use any `.message` string.
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}
