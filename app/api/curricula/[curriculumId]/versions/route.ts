import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  createDraftVersionForOwner,
  listVersionsForOwner,
} from "@/lib/curriculum/curriculum-service";
import { curriculumDraftSchema } from "@/lib/curriculum/curriculum-types";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type CurriculumVersionsRouteContext = {
  params: Promise<{ curriculumId: string }>;
};

const CURRICULUM_WRITE_LIMIT = 30;
const CURRICULUM_READ_LIMIT = 120;
const CURRICULUM_WINDOW_MS = 60_000;
// Drafts carry the full content graph (modules, nodes, sources); the schema
// caps their counts, so half a megabyte is generous headroom.
const VERSION_BODY_MAX_BYTES = 512 * 1024;

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

export async function POST(request: NextRequest, context: CurriculumVersionsRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId } = await context.params;
    const body = await parseJsonBody(request, curriculumDraftSchema, {
      maxBytes: VERSION_BODY_MAX_BYTES,
    });
    const rateLimit = await assertCurriculumRateLimit(
      request,
      principal.id,
      "curriculum-write",
      CURRICULUM_WRITE_LIMIT,
    );

    if (!rateLimit.allowed) return tooManyRequests(session, rateLimit.retryAfterSeconds);

    const version = await createDraftVersionForOwner(principal.id, curriculumId, body);
    return jsonWithSession(version, session, { status: 201 });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function GET(request: NextRequest, context: CurriculumVersionsRouteContext) {
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

    const versions = await listVersionsForOwner(principal.id, curriculumId);
    return jsonWithSession({ versions }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
