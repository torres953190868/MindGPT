export const REMEMBERED_AUTH_EMAIL_KEY = "branchmind:last-email";
export const REMEMBERED_AUTH_ACCOUNT_NAME_KEY = "branchmind:last-account-name";

export function readRememberedAuthAccountName() {
  if (typeof window === "undefined") return "";
  try {
    return (
      window.localStorage.getItem(REMEMBERED_AUTH_ACCOUNT_NAME_KEY) ??
      window.localStorage.getItem(REMEMBERED_AUTH_EMAIL_KEY) ??
      ""
    );
  } catch {
    // Storage blocked (e.g. Safari with cookies disabled): nothing remembered.
    return "";
  }
}

export function writeRememberedAuthAccountName(accountName: string | null | undefined) {
  if (typeof window === "undefined") return;
  const normalized = accountName?.trim().toLowerCase();
  if (normalized) {
    try {
      window.localStorage.setItem(REMEMBERED_AUTH_ACCOUNT_NAME_KEY, normalized);
    } catch {
      // Remembering the account name is a convenience; sign-in still works.
    }
  }
}

export const readRememberedAuthEmail = readRememberedAuthAccountName;
export const writeRememberedAuthEmail = writeRememberedAuthAccountName;
