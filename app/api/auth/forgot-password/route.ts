import type { NextRequest } from "next/server";
import {
  checkAuthRateLimit,
  getAuthRouteSession,
} from "@/lib/server/auth-password";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";

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

    throw new HttpError("Email password recovery is disabled.", {
      code: "EMAIL_AUTH_DISABLED",
      expose: true,
      status: 410,
    });
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
