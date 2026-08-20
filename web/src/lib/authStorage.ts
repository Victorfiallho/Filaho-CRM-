// Backs both the Supabase session itself and SessionTimeoutGuard's own
// "when did this session start" bookkeeping. "Keep me connected" (Login)
// picks which browser store to use: localStorage survives closing the tab/
// browser, sessionStorage is wiped the moment it closes — that's what makes
// an unchecked "Keep me connected" end the session on close with no extra
// beforeunload/signOut plumbing needed.
const REMEMBER_KEY = "fialho_remember_me";

export function getRememberMe(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "true";
}

export function setRememberMe(value: boolean) {
  localStorage.setItem(REMEMBER_KEY, String(value));
}

export function authStorageDriver(): Storage {
  return getRememberMe() ? localStorage : sessionStorage;
}

export const dynamicAuthStorage = {
  getItem: (key: string) => authStorageDriver().getItem(key),
  setItem: (key: string, value: string) => authStorageDriver().setItem(key, value),
  removeItem: (key: string) => authStorageDriver().removeItem(key)
};
