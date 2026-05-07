import type { NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ORIGIN_ENV_KEYS = [
  "APP_ORIGIN",
  "NEXT_PUBLIC_APP_ORIGIN",
  "SITE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
];

export type OriginValidationOptions = {
  allowedOrigins?: string[];
  allowMissingOrigin?: boolean;
  protectSafeMethods?: boolean;
};

export type OriginValidationResult =
  | {
      allowed: true;
      origin?: string;
      source: "origin" | "referer" | "missing" | "safe-method";
    }
  | {
      allowed: false;
      code: "FORBIDDEN_ORIGIN";
      message: string;
      origin?: string;
      reason: "missing-origin" | "invalid-origin" | "untrusted-origin";
      source: "origin" | "referer" | "missing";
      status: 403;
    };

export class OriginValidationError extends Error {
  code = "FORBIDDEN_ORIGIN";
  expose = true;
  status = 403;

  constructor(message = "Request origin is not allowed.") {
    super(message);
    this.name = "OriginValidationError";
  }
}

function splitOrigins(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];
}

export function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;

  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    return new URL(candidate).origin.toLowerCase();
  } catch {
    return null;
  }
}

function getRequestUrlOrigin(request: NextRequest) {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

function getForwardedOrigin(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;

  const protocol =
    request.headers.get("x-forwarded-proto") ??
    normalizeOrigin(getRequestUrlOrigin(request))?.split("://")[0] ??
    "https";

  return `${protocol}://${host}`;
}

export function getTrustedOrigins(
  request: NextRequest,
  options: OriginValidationOptions = {},
) {
  const origins = new Set<string>();
  const envOrigins = [
    ...splitOrigins(process.env.ALLOWED_ORIGINS),
    ...splitOrigins(process.env.TRUSTED_ORIGINS),
    ...ORIGIN_ENV_KEYS.flatMap((key) => splitOrigins(process.env[key])),
  ];

  for (const origin of [
    ...envOrigins,
    ...(options.allowedOrigins ?? []),
    getForwardedOrigin(request),
    getRequestUrlOrigin(request),
  ]) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }

  return origins;
}

function getSubmittedOrigin(request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (origin) return { origin, source: "origin" as const };

  const referer = normalizeOrigin(request.headers.get("referer"));
  if (referer) return { origin: referer, source: "referer" as const };

  return { origin: undefined, source: "missing" as const };
}

export function validateRequestOrigin(
  request: NextRequest,
  options: OriginValidationOptions = {},
): OriginValidationResult {
  if (!options.protectSafeMethods && SAFE_METHODS.has(request.method.toUpperCase())) {
    return { allowed: true, source: "safe-method" };
  }

  const submitted = getSubmittedOrigin(request);

  if (!submitted.origin) {
    if (options.allowMissingOrigin) {
      return { allowed: true, source: "missing" };
    }

    return {
      allowed: false,
      code: "FORBIDDEN_ORIGIN",
      message: "Request origin is required.",
      reason: "missing-origin",
      source: "missing",
      status: 403,
    };
  }

  const trustedOrigins = getTrustedOrigins(request, options);
  if (trustedOrigins.has(submitted.origin)) {
    return {
      allowed: true,
      origin: submitted.origin,
      source: submitted.source,
    };
  }

  return {
    allowed: false,
    code: "FORBIDDEN_ORIGIN",
    message: "Request origin is not allowed.",
    origin: submitted.origin,
    reason: "untrusted-origin",
    source: submitted.source,
    status: 403,
  };
}

export function assertValidRequestOrigin(
  request: NextRequest,
  options: OriginValidationOptions = {},
) {
  const result = validateRequestOrigin(request, options);
  if (!result.allowed) throw new OriginValidationError(result.message);
  return result;
}
