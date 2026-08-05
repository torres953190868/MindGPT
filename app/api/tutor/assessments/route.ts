import type { NextRequest } from "next/server";
import { z } from "zod";
import { submitAssessmentForOwner } from "@/lib/learning/assessment-service";
import { assertTutorAgentEnabled } from "@/lib/learning/learning-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { withIdempotency } from "@/lib/server/idempotency";

const assessmentSchema = z.object({
  enrollmentId: z.string().trim().min(1).max(160),
  nodeId: z.string().trim().min(1).max(160),
  exerciseId: z.string().trim().min(1).max(160).nullable().optional(),
  answer: z.unknown(),
}).strict();

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertTutorAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, assessmentSchema, { maxBytes: 64 * 1024 });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "tutor-assessment",
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
      { request, userId: principal.id, endpoint: "POST /api/tutor/assessments" },
      async () => ({
        status: 200,
        body: await submitAssessmentForOwner(principal.id, body),
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
