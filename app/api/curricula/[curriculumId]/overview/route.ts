import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  getCurriculumOverviewForOwner,
} from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

type CurriculumOverviewRouteContext = {
  params: Promise<{ curriculumId: string }>;
};

export async function GET(request: NextRequest, context: CurriculumOverviewRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-read",
      sessionId: principal.id,
      limit: 120,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }

    const overview = await getCurriculumOverviewForOwner(principal.id, curriculumId);
    return jsonWithSession(overview, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
