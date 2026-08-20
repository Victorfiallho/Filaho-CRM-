import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, onAuthStateChange, signIn as signInRequest, signOut as signOutRequest } from "../data/auth";
import { setRememberMe } from "../lib/authStorage";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSession()
      .then(setSession)
      .finally(() => setLoading(false));
    return onAuthStateChange(setSession);
  }, []);

  const signIn = async (email: string, password: string, remember: boolean) => {
    // Must be set before signInRequest() so the Supabase client's storage
    // adapter (dynamicAuthStorage) already knows where to persist the new
    // session's tokens when signInWithPassword() writes them.
    setRememberMe(remember);
    const next = await signInRequest(email, password);
    setSession(next);
  };

  const signOut = async () => {
    await signOutRequest();
    setSession(null);
  };

  return <AuthContext.Provider value={{ session, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
