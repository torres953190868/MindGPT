export const DEFAULT_AUTH_NEXT_PATH = "/projects";
export const AUTH_CALLBACK_PATH = "/auth/callback";

const AUTH_REDIRECT_BASE = "https://branchmind.local";

export function sanitizeAuthNext(
  value: unknown,
  fallback = DEFAULT_AUTH_NEXT_PATH,
) {
  if (typeof value !== "string") return fallback;

  const candidate = value.trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  if (candidate.includes("\\")) return fallback;

  try {
    const parsed = new URL(candidate, AUTH_REDIRECT_BASE);
    if (parsed.origin !== AUTH_REDIRECT_BASE) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function buildAuthCallbackUrl(requestUrl: string | URL, next: unknown) {
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, requestUrl);
  callbackUrl.searchParams.set("next", sanitizeAuthNext(next));
  return callbackUrl.toString();
}
