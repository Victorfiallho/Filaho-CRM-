import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { updatePassword } from "../data/auth";
import { errorMessage } from "../lib/errorMessage";
import { toast, toastError } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useT } from "../i18n/I18nContext";

// Where the reset email lands. The Supabase client turns the token in the
// URL into a session before this renders (detectSessionInUrl), so
// updateUser() is already allowed to change the password.
export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast(t("reset.tooShort")); return; }
    if (password !== confirm) { toast(t("reset.mismatch")); return; }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setDone(true);
      toast(t("reset.updated"));
    } catch (error) {
      toastError(errorMessage(error, t("reset.error")));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <main className="login-shell">
      <section className="login-card">
        <img src="/logo.png" alt="Fialho Home Improvement" className="login-logo" />
        {!session ? (
          <>
            <h1>{t("reset.invalidTitle")}</h1>
            <p className="sub">{t("reset.invalidText")}</p>
            <button className="btn" style={{ width: "100%", marginTop: 18 }} onClick={() => navigate("/login")}>{t("reset.backToLogin")}</button>
          </>
        ) : done ? (
          <>
            <h1>{t("reset.doneTitle")}</h1>
            <p className="sub">{t("reset.doneText")}</p>
            <button className="btn" style={{ width: "100%", marginTop: 18 }} onClick={() => navigate("/companies")}>{t("reset.continue")}</button>
          </>
        ) : (
          <>
            <h1>{t("reset.title")}</h1>
            <p className="sub">{t("reset.text")}</p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="reset-new">{t("reset.new")}</label>
                <input id="reset-new" value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" />
              </div>
              <div className="field">
                <label htmlFor="reset-confirm">{t("reset.confirm")}</label>
                <input id="reset-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} type="password" autoComplete="new-password" />
              </div>
              <button className="btn" style={{ width: "100%", marginTop: 18 }} type="submit" disabled={submitting}>
                {submitting ? t("reset.updating") : t("reset.update")}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
