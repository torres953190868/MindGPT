import type { NextRequest } from "next/server";
import { buildAuthCallbackUrl } from "@/lib/server/auth-redirect";
import {
  checkAuthRateLimit,
  getAuthRouteSession,
  passwordAuthSchema,
} from "@/lib/server/auth-password";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { createSupabaseCookieClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/server/validation";

export async function POST(request: NextRequest) {
  const session = getAuthRouteSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    const rateLimit = await checkAuthRateLimit(request, session, "auth-sign-up");
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

    const { email, password, next } = await parseJsonBody(
      request,
      passwordAuthSchema,
      { maxBytes: 8 * 1024 },
    );
    const supabase = await createSupabaseCookieClient();
    const emailRedirectTo = buildAuthCallbackUrl(request.url, next);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });

    if (error) {
      throw new HttpError("Unable to create account.", {
        code: "SIGN_UP_FAILED",
        status: 400,
      });
    }

    return jsonWithSession(
      {
        ok: true,
        verificationRequired: true,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
