import type { NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import {
  checkAuthRateLimit,
  getAuthRouteSession,
  updatePasswordSchema,
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

    const rateLimit = await checkAuthRateLimit(request, session, "auth-update-password");
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

    const { password, next } = await parseJsonBody(
      request,
      updatePasswordSchema,
      { maxBytes: 8 * 1024 },
    );
    const supabase = await createSupabaseCookieClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      throw new HttpError("Password reset link is invalid or expired.", {
        code: "RESET_SESSION_REQUIRED",
        expose: true,
        status: 401,
      });
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw new HttpError("Unable to update password.", {
        code: "PASSWORD_UPDATE_FAILED",
        status: 400,
      });
    }

    return jsonWithSession(
      {
        ok: true,
        next: sanitizeAuthNext(next),
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
