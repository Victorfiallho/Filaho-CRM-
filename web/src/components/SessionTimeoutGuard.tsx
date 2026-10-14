import { useEffect, useRef } from "react";
import { authStorageDriver, getRememberMe } from "../lib/authStorage";
import { toast } from "../lib/toast";
import { useAuth } from "../state/AuthContext";
import { useT } from "../i18n/I18nContext";

// Limits depend on "Keep me connected" at login (lib/authStorage.ts):
// - not kept: sign out after 30 minutes idle or 8 hours after login. The
//   session also ends when the browser closes (it's in sessionStorage).
// - kept: no idle limit, 24 hours after login.
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const REMEMBERED_MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const SESSION_STARTED_KEY = "fialho_session_started_at";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

export default function SessionTimeoutGuard() {
  const { session, signOut } = useAuth();
  const lastActivityRef = useRef(Date.now());
  const { t } = useT();

  useEffect(() => {
    const store = authStorageDriver();
    if (!session) {
      store.removeItem(SESSION_STARTED_KEY);
      return;
    }
    const remembered = getRememberMe();
    // Stamped once per login, so a reload doesn't reset the clock.
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
        toast(t("session.inactive"));
        signOut();
      } else if (now - startedAt >= maxSessionMs) {
        toast(remembered ? t("session.limit24") : t("session.limit8"));
        signOut();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
      clearInterval(interval);
    };
  }, [session, signOut, t]);

  return null;
}
