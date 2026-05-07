import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { deleteProjectForOwner } from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

const DELETE_PROJECT_LIMIT = 20;
const DELETE_PROJECT_WINDOW_MS = 60_000;

export async function DELETE(request: NextRequest, context: ProjectRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "delete-project",
      sessionId: principal.id,
      limit: DELETE_PROJECT_LIMIT,
      windowMs: DELETE_PROJECT_WINDOW_MS,
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

    const projects = await deleteProjectForOwner(principal.id, projectId);
    return jsonWithSession({ projects }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
