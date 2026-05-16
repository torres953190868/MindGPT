import { z } from "zod";
import type { NextRequest } from "next/server";
import { checkRateLimitAsync, type RateLimitResult } from "@/lib/server/rate-limit";
import { getOrCreateSession, type BranchMindSession } from "@/lib/server/session";

export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().email().max(320).toLowerCase();
export const passwordSchema = z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH);
export const authNextSchema = z.string().trim().max(2048).optional();

export const passwordAuthSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  next: authNextSchema,
});

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
