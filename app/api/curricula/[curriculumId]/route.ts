import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  archiveCurriculumForOwner,
  assertCurriculumAgentEnabled,
  getCurriculumForOwner,
  updateCurriculumForOwner,
} from "@/lib/curriculum/curriculum-service";
import { CURRICULUM_LIMITS } from "@/lib/curriculum/curriculum-types";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type CurriculumRouteContext = {
  params: Promise<{ curriculumId: string }>;
};

const updateCurriculumSchema = z.object({
  title: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxTitleLength).optional(),
  learningGoal: z
    .string()
    .trim()
    .min(1)
    .max(CURRICULUM_LIMITS.maxLearningGoalLength)
    .optional(),
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

function tooManyRequests(session: Parameters<typeof jsonWithSession>[1], retryAfterSeconds: number) {
  return jsonWithSession(
    { error: "Too many requests." },
    session,
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export async function GET(request: NextRequest, context: CurriculumRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-read",
      CURRICULUM_READ_LIMIT,
    );

    if (!rateLimit.allowed) return tooManyRequests(session, rateLimit.retryAfterSeconds);

    const curriculum = await getCurriculumForOwner(principal.id, curriculumId);
    return jsonWithSession({ curriculum }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function PATCH(request: NextRequest, context: CurriculumRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const body = await parseJsonBody(request, updateCurriculumSchema, {
      maxBytes: 64 * 1024,
    });
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-write",
      CURRICULUM_WRITE_LIMIT,
    );

    if (!rateLimit.allowed) return tooManyRequests(session, rateLimit.retryAfterSeconds);

    const curriculum = await updateCurriculumForOwner(principal.id, curriculumId, body);
    return jsonWithSession({ curriculum }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

// Spec §7.1: DELETE archives the curriculum; rows are never physically
// deleted so progress and assessment records stay auditable.
export async function DELETE(request: NextRequest, context: CurriculumRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-write",
      CURRICULUM_WRITE_LIMIT,
    );

    if (!rateLimit.allowed) return tooManyRequests(session, rateLimit.retryAfterSeconds);

    const curriculum = await archiveCurriculumForOwner(principal.id, curriculumId);
    return jsonWithSession({ curriculum }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
