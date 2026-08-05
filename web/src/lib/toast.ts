// Ported verbatim from app.js (toast) — operates on the static #toast element
// declared in index.html, same as the original (kept outside the React tree on
// purpose: it's a fire-and-forget UI utility, not app state).
export function toast(message: string) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}
