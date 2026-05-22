import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import { createBugReportForUser } from "@/lib/server/bug-reports";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";

const BUG_REPORT_LIMIT = 5;
const BUG_REPORT_WINDOW_MS = 10 * 60_000;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function formFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    const user = await getOptionalSupabaseUser();
    const principalId = user?.id ?? session.id;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "bug-report",
      sessionId: principalId,
      limit: BUG_REPORT_LIMIT,
      windowMs: BUG_REPORT_WINDOW_MS,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many bug reports." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const formData = await request.formData();
    const report = await createBugReportForUser({
      input: {
        title: formString(formData, "title"),
        description: formString(formData, "description"),
        contactEmail: formString(formData, "contactEmail"),
        currentUrl: formString(formData, "currentUrl"),
        userAgent:
          formString(formData, "userAgent") ||
          request.headers.get("user-agent") ||
          null,
      },
      screenshot: formFile(formData, "screenshot"),
      reporter: {
        userId: user?.id ?? null,
        email: user?.email ?? null,
      },
    });

    return jsonWithSession({ report }, session, { status: 201 });
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
