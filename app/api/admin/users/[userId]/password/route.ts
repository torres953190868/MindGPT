import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import {
  adminResetPasswordSchema,
  resetAdminUserPassword,
} from "@/lib/server/admin-users";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type PasswordRouteContext = {
  params: Promise<{ userId: string }>;
};

const RESET_PASSWORD_LIMIT = 10;
const RESET_PASSWORD_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: PasswordRouteContext) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    const { userId } = await context.params;

    const rateLimit = await checkRateLimitAsync(request, {
      action: "admin-reset-password",
      sessionId: session.id,
      limit: RESET_PASSWORD_LIMIT,
      windowMs: RESET_PASSWORD_WINDOW_MS,
    });
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

    const body = await parseJsonBody(request, adminResetPasswordSchema, {
      maxBytes: 16 * 1024,
    });
    await resetAdminUserPassword(userId, body.password);

    return jsonWithSession({ userId }, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
