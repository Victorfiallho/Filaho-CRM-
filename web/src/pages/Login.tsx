import { Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { requestPasswordReset } from "../data/auth";
import { errorMessage } from "../lib/errorMessage";
import { clearToast, toast, toastError } from "../lib/toast";
import LanguageSwitch from "../components/LanguageSwitch";
import { useT } from "../i18n/I18nContext";
import { useAuth } from "../state/AuthContext";

// Google's official multi-color "G" mark — standard usage for a
// "Continue with Google" button, not the app's own branding.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

export default function Login() {
  const { session, signIn, signInWithGoogle } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  // Our own messages instead of the browser's "Please fill out this field"
  // bubble, which speaks the browser's language, not the app's.
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  if (session) return <Navigate to="/companies" replace />;

  // Supabase answers in English; the one message people actually hit gets a
  // translated wording.
  const signInError = (error: unknown) => {
    const msg = errorMessage(error, t("login.error"));
    return /invalid login credentials/i.test(msg) ? t("login.invalid") : msg;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!email.trim()) next.email = t("login.needEmail");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t("login.badEmail");
    if (!password) next.password = t("login.needPassword");
    setErrors(next);
    if (next.email || next.password) return;
    setSubmitting(true);
    try {
      await signIn(email.trim(), password, rememberMe);
      clearToast();
    } catch (error) {
      toastError(signInError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      toastError(errorMessage(error, t("login.googleError")));
      setGoogleSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setErrors({ email: t("login.resetFirst") }); return; }
    setResetting(true);
    try {
      await requestPasswordReset(email.trim());
      toast(t("login.resetSent", { email: email.trim() }));
    } catch (error) {
      toastError(errorMessage(error, t("login.resetError")));
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="login-split">
      <div className="login-hero">
        <div className="login-hero-brand"><div className="login-hero-mark" /><b>Fialho Home Improvement</b></div>
        <div className="login-hero-copy">
          <h1>{t("login.heroTitle")}</h1>
          <p>{t("login.heroText")}</p>
          <div className="login-hero-rule" />
          <span>{t("login.heroNote")}</span>
        </div>
      </div>
      <section className="login-card login-card-flat">
        <div className="login-top"><LanguageSwitch /></div>
        <img src="/logo.png" alt="Fialho Home Improvement" className="login-logo" />
        <h1>{t("login.welcome")}</h1>
        <p className="sub">{t("login.subtitle")}</p>
        <button type="button" className="btn ghost google-btn" style={{ width: "100%", marginTop: 20 }} onClick={handleGoogleSignIn} disabled={googleSubmitting}>
          <GoogleIcon />{googleSubmitting ? t("login.redirecting") : t("login.google")}
        </button>
        <div className="auth-divider"><span>{t("login.or")}</span></div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">{t("login.email")}</label>
            <div className="input-with-icon">
              <Mail aria-hidden="true" />
              <input id="login-email" value={email} onChange={e => { setEmail(e.target.value); setErrors(x => ({ ...x, email: undefined })); }} type="email" autoComplete="username"
                aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "login-email-err" : undefined} />
            </div>
            {errors.email && <p className="field-error" id="login-email-err">{errors.email}</p>}
          </div>
          <div className="field">
            <label htmlFor="login-password">{t("login.password")}</label>
            <div className="input-with-icon">
              <Lock aria-hidden="true" />
              <input id="login-password" value={password} onChange={e => { setPassword(e.target.value); setErrors(x => ({ ...x, password: undefined })); }} type={showPassword ? "text" : "password"} autoComplete="current-password"
                aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "login-password-err" : undefined} />
              <button type="button" className="input-icon-btn" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}>
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
            {errors.password && <p className="field-error" id="login-password-err">{errors.password}</p>}
          </div>
          <div className="between" style={{ marginTop: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              <span className="sub" style={{ fontWeight: 500 }}>{t("login.remember")}</span>
            </label>
            <button type="button" className="link-btn" onClick={handleForgotPassword} disabled={resetting}>
              {resetting ? t("login.sending") : t("login.forgot")}
            </button>
          </div>
          <button className="btn" style={{ width: "100%", marginTop: 18 }} type="submit" disabled={submitting}>
            {submitting ? t("login.signingIn") : t("login.signIn")}
          </button>
        </form>
        <div className="login-secure-note"><ShieldCheck aria-hidden="true" />{t("login.secure")}</div>
      </section>
    </main>
  );
}
