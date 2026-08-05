import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  deriveVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { withIdempotency } from "@/lib/server/idempotency";

type CurriculumVersionDeriveRouteContext = {
  params: Promise<{ curriculumId: string; versionId: string }>;
};

const CURRICULUM_WRITE_LIMIT = 30;
const CURRICULUM_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: CurriculumVersionDeriveRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId, versionId } = await context.params;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-write",
      sessionId: principal.id,
      limit: CURRICULUM_WRITE_LIMIT,
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

    const result = await withIdempotency(
      {
        request,
        userId: principal.id,
        endpoint: `POST /api/curricula/${curriculumId}/versions/${versionId}/derive`,
      },
      async () => ({
        status: 201,
        body: await deriveVersionForOwner(principal.id, curriculumId, versionId),
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
