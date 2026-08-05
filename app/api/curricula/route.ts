import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  assertCurriculumAgentEnabled,
  createCurriculumForOwner,
  listCurriculaForOwner,
} from "@/lib/curriculum/curriculum-service";
import { CURRICULUM_LIMITS } from "@/lib/curriculum/curriculum-types";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { withIdempotency } from "@/lib/server/idempotency";

const createCurriculumSchema = z.object({
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength),
  subject: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxSubjectLength).optional(),
  learningGoal: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxLearningGoalLength),
  projectId: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength).optional(),
});

const CURRICULUM_WRITE_LIMIT = 30;
const CURRICULUM_READ_LIMIT = 120;
const CURRICULUM_WINDOW_MS = 60_000;

async function assertCurriculumRateLimit(
  request: NextRequest,
  sessionId: string,
  action: "curriculum-write" | "curriculum-read",
  limit: number,
) {
  return checkRateLimitAsync(request, {
    action,
    sessionId,
    limit,
    windowMs: CURRICULUM_WINDOW_MS,
  });
}

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, createCurriculumSchema, {
      maxBytes: 64 * 1024,
    });
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-write",
      CURRICULUM_WRITE_LIMIT,
    );

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
      { request, userId: principal.id, endpoint: "POST /api/curricula" },
      async () => ({
        status: 201,
        body: { curriculum: await createCurriculumForOwner(principal.id, body) },
      }),
    );
    return jsonWithSession(result.body, session, { status: result.status });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-read",
      CURRICULUM_READ_LIMIT,
    );

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

    const curricula = await listCurriculaForOwner(principal.id);
    return jsonWithSession({ curricula }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
