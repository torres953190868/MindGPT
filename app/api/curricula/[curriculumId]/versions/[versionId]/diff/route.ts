import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  diffVersionsForOwner,
} from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

type CurriculumVersionDiffRouteContext = {
  params: Promise<{ curriculumId: string; versionId: string }>;
};

const CURRICULUM_READ_LIMIT = 120;
const CURRICULUM_WINDOW_MS = 60_000;

export async function GET(request: NextRequest, context: CurriculumVersionDiffRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId, versionId } = await context.params;
    const againstVersionId = request.nextUrl.searchParams.get("against")?.trim() ?? "";
    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-read",
      sessionId: principal.id,
      limit: CURRICULUM_READ_LIMIT,
      windowMs: CURRICULUM_WINDOW_MS,
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

    const diff = await diffVersionsForOwner(
      principal.id,
      curriculumId,
      versionId,
      againstVersionId,
    );
    return jsonWithSession({ diff }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
