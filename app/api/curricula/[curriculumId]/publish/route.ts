import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertCurriculumAgentEnabled,
  publishVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import { CURRICULUM_LIMITS } from "@/lib/curriculum/curriculum-types";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { withIdempotency } from "@/lib/server/idempotency";

type CurriculumPublishRouteContext = {
  params: Promise<{ curriculumId: string }>;
};

const publishCurriculumSchema = z.object({
  versionId: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength),
  // Must be explicitly true; the service rejects anything else with 400
  // (spec §8.4: publishing is a confirmed, irreversible action).
  confirmation: z.boolean(),
});

const CURRICULUM_WRITE_LIMIT = 30;
const CURRICULUM_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: CurriculumPublishRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const body = await parseJsonBody(request, publishCurriculumSchema, {
      maxBytes: 64 * 1024,
    });
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
        endpoint: `POST /api/curricula/${curriculumId}/publish`,
      },
      async () => ({
        status: 200,
        body: {
          version: await publishVersionForOwner(
            principal.id,
            curriculumId,
            body.versionId,
            body.confirmation,
          ),
        },
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
