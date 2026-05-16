import type { NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import {
  checkAuthRateLimit,
  forgotPasswordSchema,
  getAuthRouteSession,
} from "@/lib/server/auth-password";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { createSupabaseCookieClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/server/validation";

function buildResetCallbackUrl(requestUrl: string, next: unknown) {
  const resetUrl = new URL("/auth/reset-password", requestUrl);
  resetUrl.searchParams.set("next", sanitizeAuthNext(next));

  const callbackUrl = new URL("/auth/callback", requestUrl);
  callbackUrl.searchParams.set(
    "next",
    `${resetUrl.pathname}${resetUrl.search}`,
  );
  return callbackUrl.toString();
}

export async function POST(request: NextRequest) {
  const session = getAuthRouteSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    const rateLimit = await checkAuthRateLimit(request, session, "auth-forgot-password");
    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const { email, next } = await parseJsonBody(
      request,
      forgotPasswordSchema,
      { maxBytes: 8 * 1024 },
    );
    const supabase = await createSupabaseCookieClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildResetCallbackUrl(request.url, next),
    });

    if (error) {
      throw new HttpError("Unable to send password reset email.", {
        code: "PASSWORD_RESET_FAILED",
        status: 502,
      });
    }

    return jsonWithSession({ ok: true }, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
