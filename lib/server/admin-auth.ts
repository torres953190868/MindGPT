import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";

export type AdminAccess =
  | {
      allowed: true;
      mode: "supabase";
      userId: string;
      email: string;
    }
  | {
      allowed: true;
      mode: "local";
      userId: null;
      email: "local-admin";
    }
  | {
      allowed: false;
      reason: "auth_required" | "not_admin" | "not_configured";
      email: string | null;
    };

function splitEnvList(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : [];
}

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function getAdminEmails(env = process.env.BRANCHMIND_ADMIN_EMAILS) {
  return new Set(splitEnvList(env));
}

export function isAdminEmail(email: string | null | undefined, env?: string) {
  const normalized = email?.trim().toLowerCase();
  return Boolean(normalized && getAdminEmails(env).has(normalized));
}

export function isLocalAdminEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    isEnabled(process.env.BRANCHMIND_ENABLE_LOCAL_ADMIN)
  );
}

export async function getAdminAccess(): Promise<AdminAccess> {
  if (isLocalAdminEnabled()) {
    return {
      allowed: true,
      mode: "local",
      userId: null,
      email: "local-admin",
    };
  }

  const user = await getOptionalSupabaseUser();
  if (!user) {
    return { allowed: false, reason: "auth_required", email: null };
  }

  const email = user.email ?? null;
  if (!isAdminEmail(email)) {
    return { allowed: false, reason: "not_admin", email };
  }

  return {
    allowed: true,
    mode: "supabase",
    userId: user.id,
    email: email ?? "",
  };
}

export async function requireAdminAccess(request: NextRequest) {
  assertValidRequestOrigin(request, {
    allowMissingOrigin: process.env.NODE_ENV !== "production",
  });

  const access = await getAdminAccess();
  if (access.allowed) return access;

  if (access.reason === "auth_required") {
    throw new HttpError("Sign in is required.", {
      code: "AUTH_REQUIRED",
      expose: true,
      status: 401,
    });
  }

  throw new HttpError("Admin access is required.", {
    code: "ADMIN_REQUIRED",
    expose: true,
    status: 403,
  });
}
