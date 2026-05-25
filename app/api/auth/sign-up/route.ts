import type { NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import {
  getAuthEmailForAccountName,
  checkAuthRateLimit,
  getAuthRouteSession,
  signUpAuthSchema,
} from "@/lib/server/auth-password";
import { tryMigrateAnonymousDataToUser } from "@/lib/server/account-migration";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import {
  createSupabaseCookieClient,
  getSupabaseAdminClient,
} from "@/lib/supabase/server";
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

    const { accountName, password, next } = await parseJsonBody(
      request,
      signUpAuthSchema,
      { maxBytes: 8 * 1024 },
    );
    const authEmail = getAuthEmailForAccountName(accountName);
    const adminSupabase = getSupabaseAdminClient();
    const { error: createError } = await adminSupabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { account_name: accountName },
    });

    if (createError) {
      throw new HttpError("Unable to create account.", {
        code: "SIGN_UP_FAILED",
        status: 400,
      });
    }

    const supabase = await createSupabaseCookieClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password,
    });

    if (error || !data.user) {
      throw new HttpError("Account was created, but sign-in failed.", {
        code: "SIGN_IN_AFTER_SIGN_UP_FAILED",
        status: 502,
      });
    }

    const migration = await tryMigrateAnonymousDataToUser(session.id, data.user.id);

    return jsonWithSession(
      {
        ok: true,
        accountName,
        next: sanitizeAuthNext(next),
        migration,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
