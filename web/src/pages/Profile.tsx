import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { updatePassword } from "../data/auth";
import { useCurrentAppUser, useIsOwner } from "../data/hooks";
import { updateMyName } from "../data/users";
import { useT } from "../i18n/I18nContext";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

const MIN_PASSWORD = 8;

// The signed-in person's own profile: their name (what the activity feed,
// notes and deal owners show) and their password. Email, role and
// permissions stay with the owner on the Users screen.
export default function Profile() {
  const { t } = useT();
  const { session } = useAuth();
  const { data: me, isLoading } = useCurrentAppUser();
  const { isOwner } = useIsOwner();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => { if (me?.name) setName(me.name); }, [me?.name]);

  const user = session?.user;
  const providers: string[] = (user?.app_metadata?.providers as string[] | undefined) || (user?.app_metadata?.provider ? [user.app_metadata.provider as string] : []);
  const hasPassword = providers.includes("email");
  const viaGoogle = providers.includes("google");
  const trimmed = name.trim();
  const nameChanged = Boolean(me) && trimmed !== (me?.name || "");

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (trimmed.length < 2) { toastError(t("profile.nameTooShort")); return; }
    setSavingName(true);
    try {
      await updateMyName(trimmed);
      queryClient.invalidateQueries({ queryKey: ["current-app-user"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast(t("profile.nameSaved"));
    } catch (error) {
      toastError(errorMessage(error, t("profile.saveFailed")));
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) { toastError(t("profile.passwordTooShort", { min: MIN_PASSWORD })); return; }
    if (password !== confirm) { toastError(t("reset.mismatch")); return; }
    setSavingPassword(true);
    try {
      await updatePassword(password);
      setPassword(""); setConfirm("");
      toast(t("profile.passwordSaved"));
    } catch (error) {
      toastError(errorMessage(error, t("profile.saveFailed")));
    } finally {
      setSavingPassword(false);
    }
  }

  if (isLoading) return null;

  return (
    <div className="profile-grid">
      <section className="card">
        <div className="card-h"><div><h3>{t("profile.details")}</h3><span className="sub">{t("profile.detailsSub")}</span></div></div>
        <div className="card-b">
          {me ? (
            <form onSubmit={saveName} noValidate>
              <div className="field">
                <label htmlFor="profile-name">{t("profile.name")}</label>
                <input id="profile-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoComplete="name" />
              </div>
              <button className="btn" type="submit" disabled={!nameChanged || savingName}>
                {savingName ? t("profile.saving") : t("profile.saveName")}
              </button>
            </form>
          ) : (
            <p className="sub">{t("profile.noProfile")}</p>
          )}
          <dl className="profile-facts">
            <div><dt>{t("profile.email")}</dt><dd>{user?.email || "—"}</dd></div>
            <div><dt>{t("profile.signIn")}</dt><dd>{[viaGoogle && "Google", hasPassword && t("profile.emailPassword")].filter(Boolean).join(" + ") || "—"}</dd></div>
            <div><dt>{t("profile.access")}</dt><dd>{isOwner ? t("profile.owner") : t("profile.member")}</dd></div>
          </dl>
          <p className="sub">{t("profile.emailHint")}</p>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><div><h3>{t("profile.password")}</h3><span className="sub">{hasPassword ? t("profile.passwordSub") : t("profile.passwordGoogle")}</span></div></div>
        <div className="card-b">
          {hasPassword ? (
            <form onSubmit={savePassword} noValidate>
              <div className="field">
                <label htmlFor="profile-pass">{t("reset.new")}</label>
                <input id="profile-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="field">
                <label htmlFor="profile-pass2">{t("reset.confirm")}</label>
                <input id="profile-pass2" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
              <button className="btn" type="submit" disabled={!password || savingPassword}>
                {savingPassword ? t("profile.saving") : t("profile.savePassword")}
              </button>
            </form>
          ) : (
            <p className="sub">{t("profile.passwordGoogleHint")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
