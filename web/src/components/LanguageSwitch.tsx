import { Languages } from "lucide-react";
import { useT } from "../i18n/I18nContext";
import { LANGS } from "../i18n/messages";

// EN / PT segmented switch for screens outside the signed-in shell (Login,
// Company picker), where there's no account menu to put it in.
export default function LanguageSwitch() {
  const { t, lang, setLang } = useT();
  return (
    <div className="lang-switch" role="group" aria-label={t("login.language")}>
      <Languages aria-hidden="true" />
      <div className="seg">
        {LANGS.map(l => (
          <button key={l.id} type="button" lang={l.id === "pt" ? "pt-BR" : "en"} className={lang === l.id ? "active" : ""} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
            {l.id.toUpperCase()}<span className="sr-only"> — {l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
