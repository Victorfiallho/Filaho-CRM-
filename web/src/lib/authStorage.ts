// Where the Supabase session (and SessionTimeoutGuard's start time) is kept.
// "Keep me connected" picks localStorage, which survives closing the
// browser; otherwise sessionStorage, which ends the session on close.
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
