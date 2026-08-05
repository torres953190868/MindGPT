import type { NextRequest } from "next/server";
import { z } from "zod";
import { migrateEnrollmentForOwner, assertTutorAgentEnabled } from "@/lib/learning/learning-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { withIdempotency } from "@/lib/server/idempotency";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

const migrationSchema = z.object({
  targetVersionId: z.string().trim().min(1).max(160),
  confirmation: z.boolean(),
}).strict();

type RouteContext = {
  params: Promise<{ curriculumId: string; enrollmentId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const fallbackSession = getOrCreateSession(request);
  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertTutorAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId, enrollmentId } = await context.params;
    const body = await parseJsonBody(request, migrationSchema, { maxBytes: 16 * 1024 });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "learning-enrollment-migrate",
      sessionId: principal.id,
      limit: 20,
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
        endpoint: `POST /api/curricula/${curriculumId}/enrollments/${enrollmentId}/migrate`,
      },
      async () => ({
        status: 200,
        body: await migrateEnrollmentForOwner(
          principal.id,
          curriculumId,
          enrollmentId,
          body,
        ),
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
