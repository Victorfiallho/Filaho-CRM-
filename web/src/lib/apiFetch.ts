import { supabase } from "./supabaseClient";

// Calls one of our /api endpoints as the signed-in user (they check the
// session and company membership). POST when there's a body, GET without.
// Throws the endpoint's error message, or `fallback`.
export async function apiFetch<T>(path: string, body?: unknown, fallback = "Request failed."): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || fallback);
  return json as T;
}
