import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  updateDraftVersionForOwner,
  getVersionForOwner,
} from "@/lib/curriculum/curriculum-service";
import { curriculumVersionPatchSchema } from "@/lib/curriculum/curriculum-types";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type CurriculumVersionRouteContext = {
  params: Promise<{ curriculumId: string; versionId: string }>;
};

const CURRICULUM_READ_LIMIT = 120;
const CURRICULUM_WRITE_LIMIT = 30;
const CURRICULUM_WINDOW_MS = 60_000;
const VERSION_PATCH_MAX_BYTES = 512 * 1024;

export async function GET(request: NextRequest, context: CurriculumVersionRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId, versionId } = await context.params;
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

    const version = await getVersionForOwner(principal.id, curriculumId, versionId);
    return jsonWithSession(version, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function PATCH(request: NextRequest, context: CurriculumVersionRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { curriculumId, versionId } = await context.params;
    const patch = await parseJsonBody(request, curriculumVersionPatchSchema, {
      maxBytes: VERSION_PATCH_MAX_BYTES,
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

    const content = await updateDraftVersionForOwner(
      principal.id,
      curriculumId,
      versionId,
      patch,
    );
    return jsonWithSession(content, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
