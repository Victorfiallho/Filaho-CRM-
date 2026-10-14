// Backs Users & Access: lists auth users, invites, grants and revokes
// company access, edits profiles and deletes accounts.
//
// company_members and users have no write RLS policy, so this endpoint is
// the only writer and enforces the rule itself: the caller must own every
// company they act on. Each change is logged to audit_log, one row per
// affected company (company_id is required there).
import { createClient } from "@supabase/supabase-js";

async function logAudit(supabase, { companyId, actorId, entity, entityId, action, diff }) {
  if (!companyId) return; // account-wide events have no company to log under
  const { error } = await supabase
    .from("audit_log")
    .insert({ company_id: companyId, user_id: actorId, entity, entity_id: entityId, action, diff: diff || {} });
  // Best-effort: a failed audit row never undoes a change that succeeded.
  if (error) console.error("audit_log insert failed", error);
}

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

    // POST: mutations, each limited to companies the caller owns.
    const { action } = req.body || {};

    if (action === "invite") {
      const { email, name, company_id: companyId, role, permissions } = req.body || {};
      if (!email || !companyId || !role) {
        res.status(400).json({ error: "Missing email, company_id, or role." });
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
      // Supabase's invite email links to /reset-password, where the person sets
      // their first password.
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/reset-password`
      });
      if (inviteError) {
        res.status(409).json({ error: inviteError.message });
        return;
      }
      const newUserId = inviteData.user.id;

      const { error: memberError } = await supabase
        .from("company_members")
        .upsert({ user_id: newUserId, company_id: companyId, role }, { onConflict: "user_id,company_id" });
      if (memberError) throw memberError;

      // A deleted account keeps its users row (see delete_user), so reuse it
      // instead of hitting the unique email.
      const { data: existingProfile } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
      const profileRow = {
        id: existingProfile?.id || newUserId,
        auth_user_id: newUserId,
        name: name || email.split("@")[0],
        email,
        role,
        permissions: Array.isArray(permissions) ? permissions : ["view"]
      };
      const { error: profileError } = await supabase.from("users").upsert(profileRow, { onConflict: "id" });
      if (profileError) throw profileError;

      await logAudit(supabase, {
        companyId, actorId: callerId, entity: "user_account", entityId: newUserId, action: "insert",
        diff: { email, role, invited_by: callerId }
      });

      res.status(200).json({ ok: true, user_id: newUserId });
      return;
    }

    if (action === "delete_user") {
      const { user_id: targetUserId } = req.body || {};
      if (!targetUserId) {
        res.status(400).json({ error: "Missing user_id." });
        return;
      }
      if (targetUserId === callerId) {
        res.status(400).json({ error: "You can't delete your own account from here." });
        return;
      }
      const { data: targetMemberships } = await supabase
        .from("company_members")
        .select("company_id, role")
        .eq("user_id", targetUserId);
      const memberships = targetMemberships || [];
      // Every company the person belongs to must be owned by the caller.
      const outsideOwnedScope = memberships.some(m => !ownedCompanyIds.has(m.company_id));
      if (outsideOwnedScope) {
        res.status(403).json({ error: "This user also belongs to a company you don't own. Remove them from your companies individually instead." });
        return;
      }
      // Refuse if any of their companies would be left without an owner.
      for (const m of memberships.filter(x => x.role === "owner")) {
        const { data: coOwners } = await supabase
          .from("company_members")
          .select("user_id")
          .eq("company_id", m.company_id)
          .eq("role", "owner");
        if ((coOwners || []).length === 1) {
          res.status(409).json({ error: "Can't delete the last owner of a company. Reassign ownership first." });
          return;
        }
      }

      const { data: targetAuthUser } = await supabase.auth.admin.getUserById(targetUserId);
      const email = targetAuthUser?.user?.email || "";

      // Deleting the auth user cascades company_members and nulls
      // users.auth_user_id. The profile row stays, so past notes and history keep
      // a name.
      const { error } = await supabase.auth.admin.deleteUser(targetUserId);
      if (error) throw error;

      for (const m of memberships) {
        await logAudit(supabase, {
          companyId: m.company_id, actorId: callerId, entity: "user_account", entityId: targetUserId, action: "delete",
          diff: { email, role: m.role }
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

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
      let previousRole = null;
      if (action === "set_role") {
        const { data: existing } = await supabase
          .from("company_members")
          .select("role")
          .eq("user_id", targetUserId)
          .eq("company_id", companyId)
          .maybeSingle();
        previousRole = existing?.role || null;
      }
      const { error } = await supabase
        .from("company_members")
        .upsert({ user_id: targetUserId, company_id: companyId, role }, { onConflict: "user_id,company_id" });
      if (error) throw error;

      await logAudit(supabase, {
        companyId, actorId: callerId, entity: "company_access", entityId: targetUserId,
        action: action === "grant" ? "insert" : "update",
        diff: action === "grant" ? { role } : { role: { from: previousRole, to: role } }
      });

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
      // Never remove a company's last owner, the caller included.
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
      const { data: existing } = await supabase
        .from("company_members")
        .select("role")
        .eq("user_id", targetUserId)
        .eq("company_id", companyId)
        .maybeSingle();
      const { error } = await supabase
        .from("company_members")
        .delete()
        .eq("user_id", targetUserId)
        .eq("company_id", companyId);
      if (error) throw error;

      await logAudit(supabase, {
        companyId, actorId: callerId, entity: "company_access", entityId: targetUserId, action: "delete",
        diff: { role: existing?.role || null }
      });

      res.status(200).json({ ok: true });
      return;
    }

    if (action === "update_profile") {
      const { auth_user_id: targetAuthUserId, id: existingId, name, email, role, permissions } = req.body || {};
      if (!targetAuthUserId || !name || !email) {
        res.status(400).json({ error: "Missing auth_user_id, name, or email." });
        return;
      }
      // Only users who share a company the caller owns.
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

      await logAudit(supabase, {
        companyId: memberRow.company_id, actorId: callerId, entity: "user_permissions", entityId: targetAuthUserId,
        action: existingId ? "update" : "insert",
        diff: { name, role: row.role, permissions: row.permissions }
      });

      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
