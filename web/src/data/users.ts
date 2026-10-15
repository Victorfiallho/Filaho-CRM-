import type { AppUser } from "../domain/types";
import { supabase } from "../lib/supabaseClient";

// `users` holds emails and permissions too; RLS limits it, and this only
// selects id and name (for note authors).
export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.from("users").select("id, name, auth_user_id");
  if (error) throw error;
  return (data || []) as AppUser[];
}

// The signed-in user's `users` row (note authors, the activity feed, the
// Profile page). A login without one gets it created by ensure_my_profile()
// (migration 2026-10-15_18); null if that isn't possible, e.g. before the
// migration ran or for a login outside every company.
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id, name, auth_user_id, permissions")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (!error && data) return data as AppUser;
  const { data: created, error: ensureError } = await supabase.rpc("ensure_my_profile");
  if (ensureError || !created?.id) return null;
  return { id: created.id, name: created.name, auth_user_id: created.auth_user_id, permissions: created.permissions || [] };
}

// Only the caller's own name; role and permissions stay owner-only.
export async function updateMyName(name: string): Promise<void> {
  const { error } = await supabase.rpc("update_my_profile", { p_name: name });
  if (error) throw error;
}
