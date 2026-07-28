export const REMEMBERED_AUTH_EMAIL_KEY = "branchmind:last-email";
export const REMEMBERED_AUTH_ACCOUNT_NAME_KEY = "branchmind:last-account-name";

export function readRememberedAuthAccountName() {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem(REMEMBERED_AUTH_ACCOUNT_NAME_KEY) ??
    window.localStorage.getItem(REMEMBERED_AUTH_EMAIL_KEY) ??
    ""
  );
}

export function writeRememberedAuthAccountName(accountName: string | null | undefined) {
  if (typeof window === "undefined") return;
  const normalized = accountName?.trim().toLowerCase();
  if (normalized) {
    window.localStorage.setItem(REMEMBERED_AUTH_ACCOUNT_NAME_KEY, normalized);
  }
}

export const readRememberedAuthEmail = readRememberedAuthAccountName;
export const writeRememberedAuthEmail = writeRememberedAuthAccountName;
