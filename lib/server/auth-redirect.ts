export const DEFAULT_AUTH_NEXT_PATH = "/projects";
export const AUTH_CALLBACK_PATH = "/auth/callback";

const AUTH_REDIRECT_BASE = "https://branchmind.local";
const AUTH_ORIGIN_ENV_KEYS = [
  "APP_ORIGIN",
  "NEXT_PUBLIC_APP_ORIGIN",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
];

function normalizeConfiguredOrigin(value: string | undefined) {
  const origin = value?.split(",")[0]?.trim();
  if (!origin) return null;

  const candidate = origin.includes("://") ? origin : `https://${origin}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function getConfiguredAuthOrigin() {
  for (const key of AUTH_ORIGIN_ENV_KEYS) {
    const origin = normalizeConfiguredOrigin(process.env[key]);
    if (origin) return origin;
  }

  return null;
}

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
  const callbackBase = getConfiguredAuthOrigin() ?? requestUrl;
  const callbackUrl = new URL(AUTH_CALLBACK_PATH, callbackBase);
  callbackUrl.searchParams.set("next", sanitizeAuthNext(next));
  return callbackUrl.toString();
}
