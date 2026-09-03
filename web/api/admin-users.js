// Vercel serverless function — backs pages/UserManagement.tsx. Lists every
// Supabase Auth user (including ones who signed up but have no
// company_members row yet, so they're stuck on an empty CompanyPicker),
// lets an owner invite a new account, grant/revoke per-company access, edit
// the `users` app-profile row (name/role/permissions), and delete an account
// outright.
//
// Same Bearer-token pattern as api/summarize-job.js and api/send-notification.js,
// but company_members/users have no insert/update/delete RLS policy at all
// (schema.sql: "provisioning stays service_role-only") — so this endpoint,
// not the client, is the only way to change them, and it re-implements that
// gate itself: the caller must hold role='owner' in company_members for at
// least one company to call this at all, and any grant/revoke/role-change is
// further restricted to companies where the caller is specifically an owner
// (an owner of company A can't use this to touch company B).
//
// Every mutation below also writes an audit_log row (same table AuditLog.tsx
// already reads) — company_members/users have no INSERT/UPDATE/DELETE
// trigger of their own (record_audit_log() is only wired to customers/jobs/
// pipeline_stages), so without this, granting/revoking access or editing
// permissions would leave no trace anywhere. audit_log.company_id is NOT
// NULL, so account-wide actions (invite, delete) log one row per company
// affected rather than a single global entry.
import { createClient } from "@supabase/supabase-js";

async function logAudit(supabase, { companyId, actorId, entity, entityId, action, diff }) {
  if (!companyId) return; // nothing to attach an account-wide, no-company event to
  const { error } = await supabase
    .from("audit_log")
    .insert({ company_id: companyId, user_id: actorId, entity, entity_id: entityId, action, diff: diff || {} });
  // Best-effort: a logging failure shouldn't undo or block a mutation that
  // already succeeded — surfaced server-side only.
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

    // POST — mutations, each scoped to companies the caller owns.
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
      // Sends Supabase's built-in invite email (magic link) landing on
      // /reset-password, which already knows how to turn a Supabase auth
      // link's token into a session and let the person set their first
      // password (same flow as "Forgot password?" — see ResetPassword.tsx).
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

      // A `users` row with this email may already exist from a prior invite
      // that was later deleted (delete_user below only unlinks auth_user_id,
      // it doesn't remove the profile row) — reuse that row's id instead of
      // colliding with users.email's unique constraint.
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
      // Every company this person belongs to must be one the caller owns —
      // otherwise deleting them would also silently strip their access to a
      // company the caller has no authority over.
      const outsideOwnedScope = memberships.some(m => !ownedCompanyIds.has(m.company_id));
      if (outsideOwnedScope) {
        res.status(403).json({ error: "This user also belongs to a company you don't own — remove them from your companies individually instead." });
        return;
      }
      // Block deletion if it would leave any of the target's companies with
      // no owner at all (same guard as revoke, just checked across every
      // company this account belongs to instead of just one).
      for (const m of memberships.filter(x => x.role === "owner")) {
        const { data: coOwners } = await supabase
          .from("company_members")
          .select("user_id")
          .eq("company_id", m.company_id)
          .eq("role", "owner");
        if ((coOwners || []).length === 1) {
          res.status(409).json({ error: "Can't delete the last owner of a company — reassign ownership first." });
          return;
        }
      }

      const { data: targetAuthUser } = await supabase.auth.admin.getUserById(targetUserId);
      const email = targetAuthUser?.user?.email || "";

      // Cascades company_members rows (FK "on delete cascade") and sets
      // users.auth_user_id to null (FK "on delete set null") — the profile
      // row itself is left in place so past notes/files/audit_log entries
      // attributed to them keep a readable name instead of going blank.
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
