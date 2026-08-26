import type { AppUser } from "../domain/types";
import { supabase } from "../lib/supabaseClient";

// The `users` app-profile table (separate from Supabase Auth — see
// schema.sql) also carries a unique email and a permissions array, so it's
// not the "non-sensitive" lookup an earlier version of this comment claimed
// (a 2026-08-26 security audit found the table had no RLS at all, in part
// because of that mischaracterization — see schema.sql's users_select
// policy). This function only selects id/name for "who wrote this note",
// but that's a UI-code choice, not something enforced by the database.
export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.from("users").select("id, name");
  if (error) throw error;
  return (data || []) as AppUser[];
}

// Resolves the signed-in Supabase Auth user to their `users` app-profile
// row, so a new note can be stamped with a real user_id. Returns null
// (rather than throwing) if the auth user has no linked profile row yet —
// the note still gets created, just without an attributed author.
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id, name")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as AppUser;
}
