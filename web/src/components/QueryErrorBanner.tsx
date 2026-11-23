import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/I18nContext";
import { failedActiveQueries } from "../lib/queryErrors";

// Most screens fall back to an empty list when a load fails, which reads as
// "you have no data". This banner says what really happened, on every screen
// at once, and retries every failed load in one click.
export default function QueryErrorBanner() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(onChange), [cache]);
  const failed = useSyncExternalStore(subscribe, () => failedActiveQueries(cache.getAll()).length);
  const [retrying, setRetrying] = useState(false);

  if (!failed) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await queryClient.refetchQueries({ type: "active", predicate: q => q.state.status === "error" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="load-error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{t("loadError.text")}</span>
      <button type="button" className="btn ghost load-error-retry" onClick={retry} disabled={retrying}>
        <RotateCw aria-hidden="true" className={retrying ? "spin-icon" : undefined} />
        {t("loadError.retry")}
      </button>
    </div>
  );
}
