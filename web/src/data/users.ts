import type { AppUser } from "../domain/types";
import { supabase } from "../lib/supabaseClient";

// `users` holds emails and permissions too; RLS limits it, and this only
// selects id and name (for note authors).
export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.from("users").select("id, name, auth_user_id");
  if (error) throw error;
  return (data || []) as AppUser[];
}

// The signed-in user's `users` row, to stamp notes with an author. Null when
// the auth user has no profile yet; the note is then saved without one.
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id, name, auth_user_id, permissions")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as AppUser;
}
