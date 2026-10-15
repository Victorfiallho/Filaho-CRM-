import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, onAuthStateChange, signIn as signInRequest, signInWithGoogle as signInWithGoogleRequest, signOut as signOutRequest } from "../data/auth";
import { setRememberMe } from "../lib/authStorage";
import { clearGoogleSession } from "../lib/googleOAuth";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    getSession()
      .then(setSession)
      .finally(() => setLoading(false));
    return onAuthStateChange(setSession);
  }, []);

  const signIn = async (email: string, password: string, remember: boolean) => {
    // Before signing in, so the storage adapter knows where to keep the new
    // session.
    setRememberMe(remember);
    const next = await signInRequest(email, password);
    setSession(next);
  };

  const signInWithGoogle = async () => {
    // A one-click OAuth sign-in has no "keep me connected" box: keep the
    // session, as if it were ticked.
    setRememberMe(true);
    await signInWithGoogleRequest();
  };

  const signOut = async () => {
    await signOutRequest();
    // Also drop the Google Workspace tokens, so they don't outlive the CRM
    // session on a shared browser.
    clearGoogleSession();
    // Nothing cached for this account survives into the next login,
    // including the assistant's chat history.
    queryClient.clear();
    try {
      Object.keys(sessionStorage).filter(k => k.startsWith("fialho_chat_")).forEach(k => sessionStorage.removeItem(k));
    } catch { /* storage blocked: nothing to clear */ }
    setSession(null);
  };

  return <AuthContext.Provider value={{ session, loading, signIn, signInWithGoogle, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
