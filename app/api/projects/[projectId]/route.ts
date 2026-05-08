import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { updateProjectSchema } from "@/lib/server/project-request";
import {
  deleteProjectForOwner,
  updateProjectForOwner,
} from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

const PATCH_PROJECT_LIMIT = 120;
const DELETE_PROJECT_LIMIT = 20;
const PROJECT_WINDOW_MS = 60_000;

async function assertProjectRateLimit(
  request: NextRequest,
  sessionId: string,
  action: string,
  limit: number,
) {
  return checkRateLimitAsync(request, {
    action,
    sessionId,
    limit,
    windowMs: PROJECT_WINDOW_MS,
  });
}

export async function PATCH(request: NextRequest, context: ProjectRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const body = await parseJsonBody(request, updateProjectSchema, {
      maxBytes: 72 * 1024,
    });
    const rateLimit = await assertProjectRateLimit(
      request,
      principal.id,
      "patch-project",
      PATCH_PROJECT_LIMIT,
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

    const project = await updateProjectForOwner(principal.id, projectId, body);
    return jsonWithSession({ project }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function DELETE(request: NextRequest, context: ProjectRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const rateLimit = await assertProjectRateLimit(
      request,
      principal.id,
      "delete-project",
      DELETE_PROJECT_LIMIT,
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

    const projects = await deleteProjectForOwner(principal.id, projectId);
    return jsonWithSession({ projects }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
