// Ported from app.js (toast) — operates on the static #toast element
// declared in index.html, same as the original (kept outside the React tree on
// purpose: it's a fire-and-forget UI utility, not app state).
//
// Two kinds: a success/info toast slides away on its own after 2.2s; an
// error toast (toastError) stays, styled red, until dismissed — error
// messages are longer and used to vanish before anyone could read them.
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function show(message: string, kind: "info" | "error") {
  const el = document.getElementById("toast");
  if (!el) return;
  // A second toast firing within 2200ms of the first (e.g. two quick saves)
  // used to leave the earlier call's timer armed — it fired mid-display of
  // the new message and yanked the "show" class off early, cutting the
  // slide/fade transition short. Clearing any pending timer before arming a
  // new one makes every toast get its own full 2200ms regardless of overlap.
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
  const hide = () => { el.classList.remove("show"); hideTimer = null; };

  el.replaceChildren(document.createTextNode(message));
  el.classList.toggle("error", kind === "error");
  // Errors are announced right away by screen readers, not queued politely.
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  if (kind === "error") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.textContent = "Dismiss";
    close.addEventListener("click", hide);
    el.append(close);
  } else {
    hideTimer = setTimeout(hide, 2200);
  }
  el.classList.add("show");
}

export function toast(message: string) {
  show(message, "info");
}

export function toastError(message: string) {
  show(message, "error");
}
