import { useEffect, useRef } from "react";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

// New functionality (not in app.js, which had no real auth to time out).
// Two independent limits: sign out after 30 minutes with no mouse/keyboard/
// touch activity, and sign out 8 hours after login no matter how active the
// person stayed — a hard end-of-session limit some businesses want on top of
// the inactivity one. Both just call signOut(); the existing route guards
// (Shell/CompanyPicker redirect to /login when `session` is null) handle
// getting back to the login screen.
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const SESSION_STARTED_KEY = "fialho_session_started_at";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

export default function SessionTimeoutGuard() {
  const { session, signOut } = useAuth();
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!session) {
      localStorage.removeItem(SESSION_STARTED_KEY);
      return;
    }
    // Stamped once per login, not per page load/refresh, so reloading the
    // page doesn't quietly reset the 8-hour clock.
    if (!localStorage.getItem(SESSION_STARTED_KEY)) {
      localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
    }
    lastActivityRef.current = Date.now();
    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      const now = Date.now();
      const startedAt = Number(localStorage.getItem(SESSION_STARTED_KEY)) || now;
      if (now - lastActivityRef.current >= INACTIVITY_LIMIT_MS) {
        toast("Signed out after 30 minutes of inactivity.");
        signOut();
      } else if (now - startedAt >= MAX_SESSION_MS) {
        toast("Signed out — 8-hour session limit reached.");
        signOut();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
  }, [session, signOut]);

  return null;
}
