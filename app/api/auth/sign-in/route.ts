import type { NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import {
  checkAuthRateLimit,
  getAuthRouteSession,
  passwordAuthSchema,
} from "@/lib/server/auth-password";
import { isSupabaseUserEmailConfirmed } from "@/lib/server/auth";
import { tryMigrateAnonymousDataToUser } from "@/lib/server/account-migration";
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

    const rateLimit = await checkAuthRateLimit(request, session, "auth-sign-in");
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !isSupabaseUserEmailConfirmed(data.user)) {
      throw new HttpError(
        "Invalid email or password, or the account has not been verified.",
        {
          code: "SIGN_IN_FAILED",
          expose: true,
          status: 401,
        },
      );
    }

    const migration = await tryMigrateAnonymousDataToUser(session.id, data.user.id);

    return jsonWithSession(
      {
        ok: true,
        next: sanitizeAuthNext(next),
        migration,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
