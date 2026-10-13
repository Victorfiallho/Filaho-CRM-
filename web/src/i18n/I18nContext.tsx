import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectLang, translate, translatePlural, type Lang, type MessageKey } from "./messages";

const STORAGE_KEY = "fialho_lang";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  tn: (key: string, count: number, vars?: Record<string, string | number>) => string;
  // Locale tag for Intl/toLocale*String calls.
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

// Per-browser language choice (account menu → Language), defaulting to the
// device language on first visit. Sets <html lang> so screen readers
// pronounce the UI correctly.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked */ }
    return detectLang(stored, typeof navigator !== "undefined" ? navigator.language : undefined);
  });

  useEffect(() => { document.documentElement.lang = lang === "pt" ? "pt-BR" : "en"; }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisting is fine */ }
  }, []);

  const value = useMemo<I18nValue>(() => ({
    lang,
    setLang,
    t: (key, vars) => translate(lang, key, vars),
    tn: (key, count, vars) => translatePlural(lang, key, count, vars),
    locale: lang === "pt" ? "pt-BR" : "en-US"
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
