import type { NextRequest } from "next/server";
import { z } from "zod";
import { enrollLearnerForVersion, assertTutorAgentEnabled } from "@/lib/learning/learning-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { withIdempotency } from "@/lib/server/idempotency";

const enrollmentSchema = z.object({
  curriculumVersionId: z.string().trim().min(1).max(160).optional(),
  // Compatibility alias for clients using the spec's versionId name.
  versionId: z.string().trim().min(1).max(160).optional(),
}).refine((value) => Boolean(value.curriculumVersionId || value.versionId), {
  message: "curriculumVersionId or versionId is required.",
  path: ["curriculumVersionId"],
});

type RouteContext = { params: Promise<{ curriculumId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const fallbackSession = getOrCreateSession(request);
  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertTutorAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const body = await parseJsonBody(request, enrollmentSchema, { maxBytes: 16 * 1024 });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "learning-enroll",
      sessionId: principal.id,
      limit: 30,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }
    const result = await withIdempotency(
      {
        request,
        userId: principal.id,
        endpoint: `POST /api/curricula/${curriculumId}/enroll`,
      },
      async () => ({
        status: 200,
        body: {
          enrollment: await enrollLearnerForVersion(
            principal.id,
            curriculumId,
            body.curriculumVersionId ?? body.versionId!,
          ),
        },
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
