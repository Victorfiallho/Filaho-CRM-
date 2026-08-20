import { useEffect, useRef } from "react";
import { authStorageDriver, getRememberMe } from "../lib/authStorage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";

// Two limits, which one applies depends on the "Keep me connected" choice
// made at login (see lib/authStorage.ts):
// - Not remembered: sign out after 30 minutes with no mouse/keyboard/touch
//   activity, or 8 hours after login regardless of activity. The session
//   also just disappears the moment the tab/browser closes, for free —
//   it lives in sessionStorage, not this timer.
// - Remembered: no inactivity limit (that would defeat the point of asking
//   to stay connected); a flat 24 hours from login instead.
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const REMEMBERED_MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const SESSION_STARTED_KEY = "fialho_session_started_at";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

export default function SessionTimeoutGuard() {
  const { session, signOut } = useAuth();
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const store = authStorageDriver();
    if (!session) {
      store.removeItem(SESSION_STARTED_KEY);
      return;
    }
    const remembered = getRememberMe();
    // Stamped once per login, not per page load/refresh, so reloading the
    // page doesn't quietly reset the session clock.
    if (!store.getItem(SESSION_STARTED_KEY)) {
      store.setItem(SESSION_STARTED_KEY, String(Date.now()));
    }
    lastActivityRef.current = Date.now();
    const markActive = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const interval = setInterval(() => {
      const now = Date.now();
      const startedAt = Number(store.getItem(SESSION_STARTED_KEY)) || now;
      const maxSessionMs = remembered ? REMEMBERED_MAX_SESSION_MS : MAX_SESSION_MS;
      if (!remembered && now - lastActivityRef.current >= INACTIVITY_LIMIT_MS) {
        toast("Signed out after 30 minutes of inactivity.");
        signOut();
      } else if (now - startedAt >= maxSessionMs) {
        toast(remembered ? "Signed out — 24-hour session limit reached." : "Signed out — 8-hour session limit reached.");
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
