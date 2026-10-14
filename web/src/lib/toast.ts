// Toasts on the static #toast element in index.html (outside React: a
// fire-and-forget utility, not app state). An info toast slides away after
// 2.2s; an error toast (toastError) stays, in red, until dismissed.
let hideTimer: ReturnType<typeof setTimeout> | null = null;
// Set by I18nProvider so the error toast's button follows the app language.
let dismissLabel = "Dismiss";
export function setToastDismissLabel(label: string) { dismissLabel = label; }

function show(message: string, kind: "info" | "error") {
  const el = document.getElementById("toast");
  if (!el) return;
  // Clear the previous timer so a toast fired during another gets its full
  // 2.2s instead of being cut short.
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
    close.textContent = dismissLabel;
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

// Hides any toast. Error toasts stay until dismissed, so without this a
// failed attempt's error would linger after the next one succeeds.
export function clearToast() {
  const el = document.getElementById("toast");
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
  el?.classList.remove("show");
}
