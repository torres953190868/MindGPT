import { z } from "zod";
import type { NextRequest } from "next/server";
import { checkRateLimitAsync, type RateLimitResult } from "@/lib/server/rate-limit";
import { getOrCreateSession, type BranchMindSession } from "@/lib/server/session";

export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
export const AUTH_ACCOUNT_NAME_MIN_LENGTH = 3;
export const AUTH_ACCOUNT_NAME_MAX_LENGTH = 32;
export const INTERNAL_ACCOUNT_EMAIL_DOMAIN = "users.branchmind.invalid";

export const emailSchema = z.string().trim().email().max(320).toLowerCase();
export const passwordSchema = z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH);
export const authNextSchema = z.string().trim().max(2048).optional();
export const accountNameSchema = z
  .string()
  .trim()
  .min(AUTH_ACCOUNT_NAME_MIN_LENGTH)
  .max(AUTH_ACCOUNT_NAME_MAX_LENGTH)
  .regex(/^[a-z0-9._-]+$/i, {
    message: "Account name can only include letters, numbers, dots, underscores, and hyphens.",
  })
  .toLowerCase();
export const signInAccountNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .toLowerCase()
  .superRefine((accountName, context) => {
    if (emailSchema.safeParse(accountName).success) return;
    if (accountNameSchema.safeParse(accountName).success) return;

    context.addIssue({
      code: "custom",
      message: "Account name must be a valid username or email address.",
    });
  });

export const signInAuthSchema = z.object({
  accountName: signInAccountNameSchema,
  password: passwordSchema,
  next: authNextSchema,
});

export const signUpAuthSchema = z.object({
  accountName: accountNameSchema,
  password: passwordSchema,
  next: authNextSchema,
});

export const passwordAuthSchema = signInAuthSchema;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  next: authNextSchema,
});

export const updatePasswordSchema = z.object({
  password: passwordSchema,
  next: authNextSchema,
});

const AUTH_RATE_LIMIT = {
  limit: 5,
  windowMs: 60_000,
};

export async function checkAuthRateLimit(
  request: NextRequest,
  session: BranchMindSession,
  action: string,
): Promise<RateLimitResult> {
  return checkRateLimitAsync(request, {
    action,
    sessionId: session.id,
    ...AUTH_RATE_LIMIT,
  });
}

export function getAuthRouteSession(request: NextRequest) {
  return getOrCreateSession(request);
}

export function buildInternalAccountEmail(accountName: string) {
  return `${accountName.trim().toLowerCase()}@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`;
}

export function getAuthEmailForAccountName(accountName: string) {
  const parsedEmail = emailSchema.safeParse(accountName);
  if (parsedEmail.success) return parsedEmail.data;
  return buildInternalAccountEmail(accountName);
}

export function isInternalAccountEmail(email: string | null | undefined) {
  return Boolean(
    email?.trim().toLowerCase().endsWith(`@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`),
  );
}

type SupabaseUserAccountIdentity = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export function getSupabaseUserPublicEmail(user: SupabaseUserAccountIdentity) {
  const email = user.email?.trim() || null;
  return isInternalAccountEmail(email) ? null : email;
}

export function getSupabaseUserAccountName(user: SupabaseUserAccountIdentity) {
  const metadataAccountName = user.user_metadata?.account_name;
  if (typeof metadataAccountName === "string" && metadataAccountName.trim()) {
    return metadataAccountName.trim().toLowerCase();
  }

  const email = user.email?.trim() || null;
  if (!email) return null;
  if (!isInternalAccountEmail(email)) return email;

  return email.slice(0, -1 * (`@${INTERNAL_ACCOUNT_EMAIL_DOMAIN}`).length);
}
