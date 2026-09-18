// Ported verbatim from app.js (toast) — operates on the static #toast element
// declared in index.html, same as the original (kept outside the React tree on
// purpose: it's a fire-and-forget UI utility, not app state).
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string) {
  const el = document.getElementById("toast");
  if (!el) return;
  // A second toast firing within 2200ms of the first (e.g. two quick saves)
  // used to leave the earlier call's timer armed — it fired mid-display of
  // the new message and yanked the "show" class off early, cutting the
  // slide/fade transition short. Clearing any pending timer before arming a
  // new one makes every toast get its own full 2200ms regardless of overlap.
  if (hideTimer !== null) clearTimeout(hideTimer);
  el.textContent = message;
  el.classList.add("show");
  hideTimer = setTimeout(() => { el.classList.remove("show"); hideTimer = null; }, 2200);
}
