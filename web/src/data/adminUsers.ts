import { supabase } from "../lib/supabaseClient";

// Mirrors web/api/admin-users.js's response shape exactly.
export interface AdminAuthUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  provider: string;
}

export interface AdminCompany {
  id: string;
  name: string;
}

export interface AdminMembership {
  user_id: string;
  company_id: string;
  role: string;
}

export interface AdminProfile {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

export interface AdminUsersData {
  authUsers: AdminAuthUser[];
  companies: AdminCompany[];
  memberships: AdminMembership[];
  profiles: AdminProfile[];
}

async function authedFetch(body?: Record<string, unknown>): Promise<AdminUsersData> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");
  const res = await fetch("/api/admin-users", {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || "Request failed.");
  return json;
}

export function listAdminUsers(): Promise<AdminUsersData> {
  return authedFetch();
}

export async function grantCompanyAccess(userId: string, companyId: string, role: "owner" | "member"): Promise<void> {
  await authedFetch({ action: "grant", user_id: userId, company_id: companyId, role });
}

export async function setCompanyRole(userId: string, companyId: string, role: "owner" | "member"): Promise<void> {
  await authedFetch({ action: "set_role", user_id: userId, company_id: companyId, role });
}

export async function revokeCompanyAccess(userId: string, companyId: string): Promise<void> {
  await authedFetch({ action: "revoke", user_id: userId, company_id: companyId });
}

export async function updateUserProfile(profile: {
  id?: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}): Promise<void> {
  await authedFetch({ action: "update_profile", ...profile });
}
