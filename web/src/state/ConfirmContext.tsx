import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/I18nContext";

// In-app replacement for window.confirm/window.prompt. The browser's own
// dialogs label their buttons in the *browser's* language ("OK / Cancelar"
// on a pt-BR Chrome even with English selected in the CRM), block the page,
// and can't be styled. These are promise-based so call sites read the same:
//
//   if (!(await confirm({ message: "Delete this lead?", danger: true }))) return;
//   const reason = await promptText({ title: "Reverse?", label: "Reason" });   // null = cancelled

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  label: string;
  confirmLabel?: string;
  defaultValue?: string;
}
type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

interface ConfirmApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  promptText: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>(resolve => setRequest({ kind: "confirm", opts, resolve })), []);
  const promptText = useCallback((opts: PromptOptions) => new Promise<string | null>(resolve => setRequest({ kind: "prompt", opts, resolve })), []);

  return (
    <ConfirmContext.Provider value={{ confirm, promptText }}>
      {children}
      {request && <ConfirmDialog request={request} onDone={() => setRequest(null)} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

function ConfirmDialog({ request, onDone }: { request: Request; onDone: () => void }) {
  const { t } = useT();
  const [text, setText] = useState(request.kind === "prompt" ? request.opts.defaultValue || "" : "");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);

  const finish = (accepted: boolean) => {
    if (request.kind === "confirm") request.resolve(accepted);
    else request.resolve(accepted ? text : null);
    onDone();
    (returnFocus.current as HTMLElement | null)?.focus?.();
  };

  useEffect(() => {
    const el = dialogRef.current;
    el?.querySelector<HTMLElement>(request.kind === "prompt" ? "input" : "[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("button, input")];
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const danger = request.kind === "confirm" && request.opts.danger;
  const title = request.opts.title || t("confirm.title");
  const confirmLabel = request.opts.confirmLabel || (danger ? t("confirm.delete") : t("confirm.ok"));
  const root = document.getElementById("modal-root") || document.body;

  return createPortal(
    <div className="modal-bg confirm-bg" onMouseDown={e => { if (e.target === e.currentTarget) finish(false); }}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role={request.kind === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={request.kind === "confirm" ? "confirm-message" : undefined}
      >
        {danger && <span className="confirm-icon" aria-hidden="true"><AlertTriangle /></span>}
        <h3 id="confirm-title">{title}</h3>
        {request.kind === "confirm" ? (
          <p id="confirm-message" className="confirm-message">{request.opts.message}</p>
        ) : (
          <form className="field" onSubmit={e => { e.preventDefault(); finish(true); }}>
            <label htmlFor="confirm-input">{request.opts.label}</label>
            <input id="confirm-input" value={text} onChange={e => setText(e.target.value)} />
          </form>
        )}
        <div className="confirm-actions">
          <button type="button" className="btn ghost" onClick={() => finish(false)}>{t("confirm.cancel")}</button>
          <button type="button" data-autofocus className={`btn${danger ? " danger" : ""}`} onClick={() => finish(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    root
  );
}
