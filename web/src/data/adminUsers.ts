import { apiFetch } from "../lib/apiFetch";

// Same shape as web/api/admin-users.js's response.
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

const authedFetch = <T = { ok: true }>(body?: Record<string, unknown>) => apiFetch<T>("/api/admin-users", body);

export function listAdminUsers(): Promise<AdminUsersData> {
  return authedFetch<AdminUsersData>();
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

export async function inviteUser(invite: {
  email: string;
  name: string;
  company_id: string;
  role: "owner" | "member";
  permissions: string[];
}): Promise<{ user_id: string }> {
  return authedFetch<{ ok: true; user_id: string }>({ action: "invite", ...invite });
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await authedFetch({ action: "delete_user", user_id: userId });
}
