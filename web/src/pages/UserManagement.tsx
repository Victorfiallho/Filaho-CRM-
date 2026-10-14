import EmptyState from "../components/EmptyState";
import PageSkeleton from "../components/PageSkeleton";
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
import { initials, relativeDate } from "../domain/format";
import type { MessageKey } from "../i18n/messages";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useT } from "../i18n/I18nContext";
import { useConfirm } from "../state/ConfirmContext";

const PERMISSIONS = ["view", "create", "edit", "import", "export"] as const;

type AccessLevel = "" | "member" | "owner";

// web/api/admin-users.js is the real gate (only owners get the data). This
// page redirects non-owners instead of showing a 403. Every change is logged
// to audit_log (company_access / user_account / user_permissions).
export default function UserManagement() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const { data, isLoading, error } = useAdminUsers();
  const { t, tn, locale } = useT();
  const [managingUser, setManagingUser] = useState<AdminAuthUser | null>(null);
  const [inviting, setInviting] = useState(false);
  const navigate = useNavigate();

  if (ownerLoading) return null;
  if (!isOwner) return <Navigate to="/dashboard" replace />;

  if (error) {
    return <section className="card"><div className="card-b"><EmptyState icon={ShieldAlert}>{errorMessage(error, t("users.loadError"))}</EmptyState></div></section>;
  }
  if (isLoading || !data) return <PageSkeleton cards={1} rows={8} fullWidth />;

  const { authUsers, companies, memberships, profiles } = data;
  const membershipsByUser = new Map<string, AdminMembership[]>();
  for (const m of memberships) {
    membershipsByUser.set(m.user_id, [...(membershipsByUser.get(m.user_id) || []), m]);
  }
  const profileByAuthUserId = new Map(profiles.filter(p => p.auth_user_id).map(p => [p.auth_user_id as string, p]));
  const companiesById = new Map(companies.map(c => [c.id, c]));

  const pendingUsers = authUsers.filter(u => !(membershipsByUser.get(u.id) || []).length);
  const activeUsers = authUsers.filter(u => (membershipsByUser.get(u.id) || []).length);
  const displayName = (u: AdminAuthUser) => profileByAuthUserId.get(u.id)?.name || u.email;
  const lastActive = (u: AdminAuthUser) => (u.last_sign_in_at ? relativeDate(u.last_sign_in_at, new Date(), locale) : t("users.never"));
  const accessBadges = (u: AdminAuthUser) => (membershipsByUser.get(u.id) || []).map(r => (
    <span key={r.company_id} className={`badge-tone tone-${r.role === "owner" ? "purple" : "slate"}`}>
      {companiesById.get(r.company_id)?.name || r.company_id} · {t(`role.${r.role}` as MessageKey)}
    </span>
  ));

  return (
    <>
      <div className="page-toolbar spread">
        <span className="sub">{tn("users.total", authUsers.length)}</span>
        <div className="inline-actions">
          <button className="btn ghost slim" onClick={() => navigate("/audit-log")}><History aria-hidden="true" />{t("users.auditLog")}</button>
          <button className="btn slim" onClick={() => setInviting(true)}><UserPlus aria-hidden="true" />{t("users.invite")}</button>
        </div>
      </div>

      {pendingUsers.length > 0 && (
        <section className="card attention-card" style={{ marginBottom: 20 }}>
          <div className="card-h">
            <h3>{t("users.pending")}</h3>
            <span className="badge-tone tone-amber">{t("users.pendingCount", { count: pendingUsers.length })}</span>
          </div>
          <div className="card-b">
            <ul className="user-list">
              {pendingUsers.map(u => (
                <li key={u.id} className="user-row">
                  <span className="lead-avatar tone-amber" aria-hidden="true">{initials(u.email)}</span>
                  <div className="user-row-main"><b>{u.email}</b><span className="sub">{t("users.col.signedUp")}: {relativeDate(u.created_at, new Date(), locale)}</span></div>
                  <button className="btn slim" onClick={() => setManagingUser(u)}><UserPlus aria-hidden="true" />{t("users.grant")}</button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-h"><h3>{t("users.all")}</h3></div>
        <div className="card-b">
          {activeUsers.length === 0 && <EmptyState icon={UserPlus}>{t("users.none")}</EmptyState>}
          <ul className="user-list">
            {activeUsers.map(u => (
              <li key={u.id} className="user-row">
                <span className="lead-avatar tone-blue" aria-hidden="true">{initials(displayName(u))}</span>
                <div className="user-row-main">
                  <b>{displayName(u)}</b>
                  <span className="sub">{u.email} · {t("users.col.lastActive")}: {lastActive(u)}</span>
                  <div className="user-row-access">{accessBadges(u)}</div>
                </div>
                <button className="btn ghost slim" onClick={() => setManagingUser(u)}><Settings2 aria-hidden="true" />{t("users.manage")}</button>
              </li>
            ))}
          </ul>
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
  const { t } = useT();
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
      toast(t("users.required"));
      return;
    }
    setSending(true);
    try {
      await inviteUser({ email: email.trim(), name: name.trim(), company_id: companyId, role, permissions });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast(t("users.inviteSent", { email: email.trim() }));
      onClose();
    } catch (err) {
      toastError(errorMessage(err, t("users.inviteError")));
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <section className="modal" style={{ width: "min(480px,100%)" }} onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3>{t("users.inviteTitle")}</h3>
          <button className="round-btn" onClick={onClose} aria-label={t("users.close")}><X aria-hidden="true" /></button>
        </div>
        <div className="modal-b">
          <p className="sub">{t("users.inviteText")}</p>
          <div className="field">
            <label htmlFor="invite-email">{t("users.email")}</label>
            <input id="invite-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="field">
            <label htmlFor="invite-name">{t("users.nameOptional")}</label>
            <input id="invite-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("users.fullName")} />
          </div>
          <div className="form-row">
            <div className="field">
              <label>{t("users.company")}</label>
              <Select aria-label={t("users.company")} value={companyId} onChange={setCompanyId} options={companies.map(c => ({ value: c.id, label: c.name }))} />
            </div>
            <div className="field">
              <label>{t("users.role")}</label>
              <Select aria-label={t("users.role")} value={role} onChange={v => setRole(v as "owner" | "member")} options={[{ value: "member", label: t("role.member") }, { value: "owner", label: t("role.owner") }]} />
            </div>
          </div>
          <div className="field">
            <label>{t("users.permissions")}</label>
            <PermissionChecks value={permissions} onToggle={togglePermission} />
          </div>
        </div>
        <div className="modal-f">
          <button className="btn ghost" onClick={onClose} disabled={sending}>{t("users.cancel")}</button>
          <button className="btn" onClick={handleInvite} disabled={sending}>{sending ? t("users.sending") : t("users.sendInvite")}</button>
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
  const { t, locale } = useT();
  const { confirm } = useConfirm();
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
      toast(t("users.updated", { email: authUser.email }));
      onClose();
    } catch (err) {
      toastError(errorMessage(err, t("users.updateError")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (isSelf) return;
    if (!(await confirm({ message: t("confirm.deleteAccount", { email: authUser.email || "" }), danger: true }))) return;
    setDeleting(true);
    try {
      await deleteUserAccount(authUser.id);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast(t("users.deleted", { email: authUser.email }));
      onClose();
    } catch (err) {
      toastError(errorMessage(err, t("users.deleteError")));
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
            <span className="sub">{t("users.signedUpVia", { date: relativeDate(authUser.created_at, new Date(), locale), provider: authUser.provider })}</span>
          </div>
          <button className="round-btn" onClick={onClose} aria-label={t("users.close")}><X aria-hidden="true" /></button>
        </div>
        <div className="modal-b">
          <div className="field">
            <label htmlFor="manage-name">{t("users.name")}</label>
            <input id="manage-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("users.fullName")} />
          </div>

          <div className="field">
            <label>{t("users.col.access")}</label>
            <ul className="access-list">
              {companies.map(c => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  <div className="pill-select">
                    <Select
                      id={`access-${c.id}`}
                      aria-label={`${c.name}: ${t("users.col.access")}`}
                      value={access[c.id]}
                      onChange={v => setAccess(a => ({ ...a, [c.id]: v as AccessLevel }))}
                      options={[
                        { value: "", label: t("role.none") },
                        { value: "member", label: t("role.member") },
                        { value: "owner", label: t("role.owner") }
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {isSelf && <p className="sub">{t("users.selfNote")}</p>}
          </div>

          <div className="field">
            <label>{t("users.permissions")}</label>
            <PermissionChecks value={permissions} onToggle={togglePermission} />
            <p className="sub">{t("users.permHelp")}</p>
          </div>
        </div>
        <div className="modal-f between">
          {!isSelf ? (
            <button className="btn slim danger" onClick={handleDeleteAccount} disabled={saving || deleting}>
              <Trash2 aria-hidden="true" />{deleting ? t("users.deleting") : t("users.deleteAccount")}
            </button>
          ) : <span className="sub">{t("users.immediate")}</span>}
          <div className="inline-actions">
            <button className="btn ghost" onClick={onClose} disabled={saving || deleting}>{t("users.cancel")}</button>
            <button className="btn" onClick={handleSave} disabled={saving || deleting}>{saving ? t("users.saving") : t("users.save")}</button>
          </div>
        </div>
      </section>
    </div>,
    document.getElementById("modal-root")!
  );
}

function PermissionChecks({ value, onToggle }: { value: string[]; onToggle: (key: string) => void }) {
  const { t } = useT();
  return (
    <div className="check-grid">
      {PERMISSIONS.map(key => (
        <label key={key} className="check-row">
          <input type="checkbox" checked={value.includes(key)} onChange={() => onToggle(key)} />
          <span>{t(`perm.${key}` as MessageKey)}</span>
        </label>
      ))}
    </div>
  );
}
