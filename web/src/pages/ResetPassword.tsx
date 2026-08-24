import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { updatePassword } from "../data/auth";
import { errorMessage } from "../lib/errorMessage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

// Landing page for the email link from requestPasswordReset() (Login.tsx's
// "Forgot password?"). Supabase's client auto-detects the recovery token in
// the URL hash and turns it into a real session before this ever renders
// (detectSessionInUrl defaults to true — see lib/supabaseClient.ts), so by
// the time useAuth().session is set, supabase.auth.updateUser() below is
// already authorized to change that account's password.
export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast("Password must be at least 6 characters."); return; }
    if (password !== confirm) { toast("Passwords don't match."); return; }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setDone(true);
      toast("Password updated.");
    } catch (error) {
      toast(errorMessage(error, "Could not update the password."));
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
            <h1>Reset link invalid or expired</h1>
            <p className="sub">Request a new password reset link from the login page.</p>
            <button className="btn" style={{ width: "100%", marginTop: 18 }} onClick={() => navigate("/login")}>Back to login</button>
          </>
        ) : done ? (
          <>
            <h1>Password updated</h1>
            <p className="sub">You can now continue to your workspace.</p>
            <button className="btn" style={{ width: "100%", marginTop: 18 }} onClick={() => navigate("/companies")}>Continue</button>
          </>
        ) : (
          <>
            <h1>Set a new password</h1>
            <p className="sub">Choose a new password for your account.</p>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>New password</label>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password" required />
              </div>
              <div className="field">
                <label>Confirm password</label>
                <input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" autoComplete="new-password" required />
              </div>
              <button className="btn" style={{ width: "100%", marginTop: 18 }} type="submit" disabled={submitting}>
                {submitting ? "Updating..." : "Update password"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
