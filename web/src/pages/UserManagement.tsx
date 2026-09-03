import { useQueryClient } from "@tanstack/react-query";
import { History, Settings2, ShieldAlert, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, useNavigate } from "react-router-dom";
import Select from "../components/Select";
import {
  deleteUserAccount,
  grantCompanyAccess,
  inviteUser,
  revokeCompanyAccess,
  setCompanyRole,
  updateUserProfile,
  type AdminAuthUser,
  type AdminCompany,
  type AdminMembership,
  type AdminProfile
} from "../data/adminUsers";
import { useAdminUsers, useIsOwner } from "../data/hooks";
import { relativeDate } from "../domain/format";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

const PERMISSIONS: [string, string][] = [
  ["view", "View records"],
  ["create", "Create records"],
  ["edit", "Edit + delete records"],
  ["import", "Import Center"],
  ["export", "Export data"]
];

type AccessLevel = "" | "member" | "owner";

// Server-side gate is web/api/admin-users.js (only a company owner can even
// GET the data); this page mirrors that with useIsOwner so a non-owner
// following a stray /users link sees a normal redirect, not a raw API 403.
// Every grant/revoke/invite/delete/permission-edit this page triggers gets
// logged to audit_log server-side — see AuditLog.tsx (filterable there under
// entity "company_access" / "user_account" / "user_permissions").
export default function UserManagement() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const { data, isLoading, error } = useAdminUsers();
  const [managingUser, setManagingUser] = useState<AdminAuthUser | null>(null);
  const [inviting, setInviting] = useState(false);
  const navigate = useNavigate();

  if (ownerLoading) return null;
  if (!isOwner) return <Navigate to="/dashboard" replace />;

  if (error) {
    return (
      <div className="empty"><ShieldAlert />{errorMessage(error, "Could not load users.")}</div>
    );
  }
  if (isLoading || !data) return <div className="empty">Loading users...</div>;

  const { authUsers, companies, memberships, profiles } = data;
  const membershipsByUser = new Map<string, AdminMembership[]>();
  for (const m of memberships) {
    membershipsByUser.set(m.user_id, [...(membershipsByUser.get(m.user_id) || []), m]);
  }
  const profileByAuthUserId = new Map(profiles.filter(p => p.auth_user_id).map(p => [p.auth_user_id as string, p]));
  const companiesById = new Map(companies.map(c => [c.id, c]));

  const pendingUsers = authUsers.filter(u => !(membershipsByUser.get(u.id) || []).length);
  const activeUsers = authUsers.filter(u => (membershipsByUser.get(u.id) || []).length);

  return (
    <>
      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <div>
            <h3>Users &amp; permissions</h3>
            <div className="sub">{authUsers.length} account{authUsers.length === 1 ? "" : "s"} total</div>
          </div>
          <div className="inline-actions">
            <button className="btn ghost slim" onClick={() => navigate("/audit-log")}><History />Audit log</button>
            <button className="btn slim" onClick={() => setInviting(true)}><UserPlus />Invite user</button>
          </div>
        </div>
      </section>

      {pendingUsers.length > 0 && (
        <section className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <h3>New sign-ups awaiting access</h3>
            <span className="pill status-lost">{pendingUsers.length} pending</span>
          </div>
          <div className="card-b table-wrap">
            <table>
              <thead>
                <tr><th>Email</th><th>Signed up</th><th></th></tr>
              </thead>
              <tbody>
                {pendingUsers.map(u => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td className="sub">{relativeDate(u.created_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn slim" onClick={() => setManagingUser(u)}><UserPlus />Grant access</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-h">
          <h3>All accounts</h3>
        </div>
        <div className="card-b table-wrap">
          <table>
            <thead>
              <tr><th>Email</th><th>Company access</th><th>Last active</th><th></th></tr>
            </thead>
            <tbody>
              {activeUsers.map(u => {
                const rows = membershipsByUser.get(u.id) || [];
                return (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      {rows.map(r => (
                        <span key={r.company_id} className={`pill${r.role === "owner" ? " status-active" : ""}`} style={{ marginRight: 6, marginBottom: 4 }}>
                          {companiesById.get(r.company_id)?.name || r.company_id} · {r.role}
                        </span>
                      ))}
                    </td>
                    <td className="sub">{u.last_sign_in_at ? relativeDate(u.last_sign_in_at) : "Never signed in"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ghost slim" onClick={() => setManagingUser(u)}><Settings2 />Manage</button>
                    </td>
                  </tr>
                );
              })}
              {authUsers.length === 0 && (
                <tr><td colSpan={4}><div className="empty">No users yet.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {managingUser && (
        <ManageUserModal
          authUser={managingUser}
          companies={companies}
          memberships={membershipsByUser.get(managingUser.id) || []}
          profile={profileByAuthUserId.get(managingUser.id) || null}
          onClose={() => setManagingUser(null)}
        />
      )}

      {inviting && <InviteUserModal companies={companies} onClose={() => setInviting(false)} />}
    </>
  );
}

function InviteUserModal({ companies, onClose }: { companies: AdminCompany[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id || "");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [permissions, setPermissions] = useState<string[]>(["view"]);
  const [sending, setSending] = useState(false);

  function togglePermission(key: string) {
    setPermissions(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]));
  }

  async function handleInvite() {
    if (!email.trim() || !companyId) {
      toast("Email and a company are required.");
      return;
    }
    setSending(true);
    try {
      await inviteUser({ email: email.trim(), name: name.trim(), company_id: companyId, role, permissions });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast(`Invite sent to ${email.trim()}.`);
      onClose();
    } catch (err) {
      toast(errorMessage(err, "Could not send that invite."));
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" style={{ width: "min(480px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3>Invite a new user</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-b">
          <p className="sub">Sends a Supabase account-invite email with a link to set their password and sign in.</p>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field">
            <label>Display name (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Company</label>
              <Select value={companyId} onChange={setCompanyId} options={companies.map(c => ({ value: c.id, label: c.name }))} />
            </div>
            <div className="field">
              <label>Role</label>
              <Select value={role} onChange={v => setRole(v as "owner" | "member")} options={[{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }]} />
            </div>
          </div>
          <div className="field">
            <label>Permissions</label>
            <div className="inline-actions" style={{ flexWrap: "wrap" }}>
              {PERMISSIONS.map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 150 }}>
                  <input type="checkbox" checked={permissions.includes(key)} onChange={() => togglePermission(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="btn" onClick={handleInvite} disabled={sending}>{sending ? "Sending..." : "Send invite"}</button>
        </div>
      </section>
    </div>,
    document.getElementById("modal-root")!
  );
}

function ManageUserModal({
  authUser,
  companies,
  memberships,
  profile,
  onClose
}: {
  authUser: AdminAuthUser;
  companies: AdminCompany[];
  memberships: AdminMembership[];
  profile: AdminProfile | null;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const initialAccess: Record<string, AccessLevel> = Object.fromEntries(
    companies.map(c => [c.id, (memberships.find(m => m.company_id === c.id)?.role as AccessLevel) || ""])
  );
  const [access, setAccess] = useState<Record<string, AccessLevel>>(initialAccess);
  const [name, setName] = useState(profile?.name || authUser.email.split("@")[0]);
  const [permissions, setPermissions] = useState<string[]>(profile?.permissions || ["view"]);

  const isSelf = session?.user.id === authUser.id;

  function togglePermission(key: string) {
    setPermissions(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const changedCompanyIds = companies.map(c => c.id).filter(id => access[id] !== initialAccess[id]);
      for (const companyId of changedCompanyIds) {
        const level = access[companyId];
        const had = initialAccess[companyId];
        if (level === "") {
          await revokeCompanyAccess(authUser.id, companyId);
        } else if (had === "") {
          await grantCompanyAccess(authUser.id, companyId, level);
        } else {
          await setCompanyRole(authUser.id, companyId, level);
        }
      }
      const hasAnyAccess = Object.values(access).some(v => v !== "");
      if (hasAnyAccess) {
        const highestRole = Object.values(access).includes("owner") ? "owner" : "member";
        await updateUserProfile({
          id: profile?.id,
          auth_user_id: authUser.id,
          name: name.trim() || authUser.email,
          email: authUser.email,
          role: highestRole,
          permissions
        });
      }
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast(`Access updated for ${authUser.email}.`);
      onClose();
    } catch (err) {
      toast(errorMessage(err, "Could not update this user."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (isSelf) return;
    if (!window.confirm(`Permanently delete ${authUser.email}'s account? They will lose all access and won't be able to log in again — this can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteUserAccount(authUser.id);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast(`${authUser.email}'s account was deleted.`);
      onClose();
    } catch (err) {
      toast(errorMessage(err, "Could not delete this account."));
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" style={{ width: "min(640px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h3>{authUser.email}</h3>
            <span className="sub">Signed up {relativeDate(authUser.created_at)} via {authUser.provider}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-b">
          <div className="field">
            <label>Display name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
          </div>

          <div className="field">
            <label>Company access</label>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Company</th><th>Access</th></tr></thead>
                <tbody>
                  {companies.map(c => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td style={{ maxWidth: 160 }}>
                        <Select
                          id={`access-${c.id}`}
                          value={access[c.id]}
                          onChange={v => setAccess(a => ({ ...a, [c.id]: v as AccessLevel }))}
                          options={[
                            { value: "", label: "No access" },
                            { value: "member", label: "Member" },
                            { value: "owner", label: "Owner" }
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isSelf && <p className="sub">This is your own account — removing your last owner role on a company is blocked server-side.</p>}
          </div>

          <div className="field">
            <label>Permissions</label>
            <div className="inline-actions" style={{ flexWrap: "wrap" }}>
              {PERMISSIONS.map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 150 }}>
                  <input type="checkbox" checked={permissions.includes(key)} onChange={() => togglePermission(key)} />
                  {label}
                </label>
              ))}
            </div>
            <p className="sub">
              Owners always have full access regardless of these checkboxes. For everyone else: create/edit gate the
              "New lead/client/job" buttons and Save in the record modal, import gates the Import Center nav item and
              page, export gates the Clients CSV export button.
            </p>
          </div>
        </div>
        <div className="modal-f between">
          {!isSelf ? (
            <button className="btn ghost slim" style={{ color: "var(--red)" }} onClick={handleDeleteAccount} disabled={saving || deleting}>
              <Trash2 />{deleting ? "Deleting..." : "Delete account"}
            </button>
          ) : <span className="sub">Changes apply immediately.</span>}
          <div className="inline-actions">
            <button className="btn ghost" onClick={onClose} disabled={saving || deleting}>Cancel</button>
            <button className="btn" onClick={handleSave} disabled={saving || deleting}>{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </div>
      </section>
    </div>,
    document.getElementById("modal-root")!
  );
}
