import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { getAdminAnalytics } from "@/lib/server/admin-analytics";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);

    const days = Number(request.nextUrl.searchParams.get("days") ?? "30");
    if (days !== 7 && days !== 30) {
      throw new HttpError("Invalid analytics range; expected 7 or 30 days.", {
        code: "ADMIN_ANALYTICS_DAYS_INVALID",
        expose: true,
        status: 400,
      });
    }

    return jsonWithSession(
      { analytics: await getAdminAnalytics(days) },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
