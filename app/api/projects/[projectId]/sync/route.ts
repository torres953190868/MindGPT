import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { syncProjectSchema } from "@/lib/server/project-request";
import { syncProjectForOwner } from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type ProjectSyncRouteContext = {
  params: Promise<{ projectId: string }>;
};

const SYNC_PROJECT_LIMIT = 20;
const SYNC_PROJECT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: ProjectSyncRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const { project } = await parseJsonBody(request, syncProjectSchema, {
      maxBytes: 512 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "sync-project",
      sessionId: principal.id,
      limit: SYNC_PROJECT_LIMIT,
      windowMs: SYNC_PROJECT_WINDOW_MS,
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

    const syncedProject = await syncProjectForOwner(principal.id, projectId, project);
    return jsonWithSession({ project: syncedProject }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
