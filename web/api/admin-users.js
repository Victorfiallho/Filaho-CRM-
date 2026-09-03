// Vercel serverless function — backs pages/UserManagement.tsx. Lists every
// Supabase Auth user (including ones who signed up but have no
// company_members row yet, so they're stuck on an empty CompanyPicker) and
// lets an owner grant/revoke per-company access and edit the `users`
// app-profile row (name/role/permissions).
//
// Same Bearer-token pattern as api/summarize-job.js and api/send-notification.js,
// but company_members/users have no insert/update/delete RLS policy at all
// (schema.sql: "provisioning stays service_role-only") — so this endpoint,
// not the client, is the only way to change them, and it re-implements that
// gate itself: the caller must hold role='owner' in company_members for at
// least one company to call this at all, and any grant/revoke/role-change is
// further restricted to companies where the caller is specifically an owner
// (an owner of company A can't use this to touch company B).
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      res.status(401).json({ error: "Invalid or expired session." });
      return;
    }
    const callerId = userData.user.id;

    const { data: ownerRows } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", callerId)
      .eq("role", "owner");
    const ownedCompanyIds = new Set((ownerRows || []).map(r => r.company_id));
    if (!ownedCompanyIds.size) {
      res.status(403).json({ error: "Only a company owner can manage users." });
      return;
    }

    if (req.method === "GET") {
      const [authUsersRes, companiesRes, membershipsRes, profilesRes] = await Promise.all([
        supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        supabase.from("companies").select("id, name").order("name"),
        supabase.from("company_members").select("user_id, company_id, role"),
        supabase.from("users").select("id, auth_user_id, name, email, role, permissions")
      ]);
      if (authUsersRes.error) throw authUsersRes.error;
      if (companiesRes.error) throw companiesRes.error;
      if (membershipsRes.error) throw membershipsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      res.status(200).json({
        authUsers: authUsersRes.data.users.map(u => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          provider: u.app_metadata?.provider || "email"
        })),
        companies: companiesRes.data,
        memberships: membershipsRes.data,
        profiles: profilesRes.data
      });
      return;
    }

    // POST — mutations, each scoped to companies the caller owns.
    const { action } = req.body || {};

    if (action === "grant" || action === "set_role") {
      const { user_id: targetUserId, company_id: companyId, role } = req.body || {};
      if (!targetUserId || !companyId || !role) {
        res.status(400).json({ error: "Missing user_id, company_id, or role." });
        return;
      }
      if (role !== "owner" && role !== "member") {
        res.status(400).json({ error: "role must be 'owner' or 'member'." });
        return;
      }
      if (!ownedCompanyIds.has(companyId)) {
        res.status(403).json({ error: "You are not an owner of that company." });
        return;
      }
      const { error } = await supabase
        .from("company_members")
        .upsert({ user_id: targetUserId, company_id: companyId, role }, { onConflict: "user_id,company_id" });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "revoke") {
      const { user_id: targetUserId, company_id: companyId } = req.body || {};
      if (!targetUserId || !companyId) {
        res.status(400).json({ error: "Missing user_id or company_id." });
        return;
      }
      if (!ownedCompanyIds.has(companyId)) {
        res.status(403).json({ error: "You are not an owner of that company." });
        return;
      }
      // Guard against locking a company out of its own admin: refuse to
      // remove the last owner (including the caller removing themselves).
      const { data: remainingOwners } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", companyId)
        .eq("role", "owner");
      const isSoleOwner = (remainingOwners || []).length === 1 && remainingOwners[0].user_id === targetUserId;
      if (isSoleOwner) {
        res.status(409).json({ error: "Can't remove the last owner of a company." });
        return;
      }
      const { error } = await supabase
        .from("company_members")
        .delete()
        .eq("user_id", targetUserId)
        .eq("company_id", companyId);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "update_profile") {
      const { auth_user_id: targetAuthUserId, id: existingId, name, email, role, permissions } = req.body || {};
      if (!targetAuthUserId || !name || !email) {
        res.status(400).json({ error: "Missing auth_user_id, name, or email." });
        return;
      }
      // Only for a user the caller can actually see, i.e. shares an owned
      // company with — same boundary as every other action here.
      const { data: memberRow } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", targetAuthUserId)
        .in("company_id", Array.from(ownedCompanyIds))
        .limit(1)
        .maybeSingle();
      if (!memberRow) {
        res.status(403).json({ error: "That user isn't a member of a company you own." });
        return;
      }
      const row = {
        id: existingId || targetAuthUserId,
        auth_user_id: targetAuthUserId,
        name,
        email,
        role: role || "member",
        permissions: Array.isArray(permissions) ? permissions : []
      };
      const { error } = await supabase.from("users").upsert(row, { onConflict: "id" });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
