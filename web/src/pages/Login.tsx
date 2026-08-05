import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

export default function Login() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (session) return <Navigate to="/companies" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="mark">FC</div>
        <h1>Fialho CRM</h1>
        <p className="sub">Multi-company CRM operations.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
          </div>
          <button className="btn" style={{ width: "100%", marginTop: 18 }} type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
