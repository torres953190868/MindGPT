import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAndEnqueueCurriculumJob } from "@/lib/agents/curriculum-builder/curriculum-jobs";
import { CURRICULUM_LIMITS, curriculumBuildRequestSchema } from "@/lib/curriculum/curriculum-types";
import { getCurriculumForOwner } from "@/lib/curriculum/curriculum-service";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import {
  HttpError,
  jsonWithSession,
  safeErrorWithSession,
} from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { assertMonthlyCurriculumGenerationQuota } from "@/lib/server/curriculum-generation-quota";

const generateCurriculumSchema = curriculumBuildRequestSchema.extend({
  curriculumId: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength),
});

const GENERATE_LIMIT = 10;
const GENERATE_WINDOW_MS = 60_000;
const BODY_MAX_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();

    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, generateCurriculumSchema, {
      maxBytes: BODY_MAX_BYTES,
    });
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
      throw new HttpError("Idempotency-Key header is required for curriculum generation.", {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        expose: true,
        status: 400,
      });
    }

    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-generate",
      sessionId: principal.id,
      limit: GENERATE_LIMIT,
      windowMs: GENERATE_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
        { requestId },
      );
    }

    const accountPlan = await getAccountPlanForModelAccess(principal);
    await assertMonthlyCurriculumGenerationQuota({ ...principal, plan: accountPlan });

    // Ownership check (404 if missing or foreign-owned).
    await getCurriculumForOwner(principal.id, body.curriculumId);

    const run = await createAndEnqueueCurriculumJob({
      ownerId: principal.id,
      curriculumId: body.curriculumId,
      request: {
        subject: body.subject,
        learnerProfile: body.learnerProfile,
        learningGoal: body.learningGoal,
        constraints: body.constraints,
        sourcePreferences: body.sourcePreferences,
      },
      requestId,
      accountPlan: accountPlan ?? null,
      idempotencyKey,
    });
    return jsonWithSession({ runId: run.id, status: run.status }, session, { status: 202 }, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
