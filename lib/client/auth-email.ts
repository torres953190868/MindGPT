export const REMEMBERED_AUTH_EMAIL_KEY = "branchmind:last-email";

export function readRememberedAuthEmail() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(REMEMBERED_AUTH_EMAIL_KEY) ?? "";
}

export function writeRememberedAuthEmail(email: string | null | undefined) {
  if (typeof window === "undefined") return;
  const normalized = email?.trim().toLowerCase();
  if (normalized) window.localStorage.setItem(REMEMBERED_AUTH_EMAIL_KEY, normalized);
}
