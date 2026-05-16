import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { createProjectSchema } from "@/lib/server/project-request";
import { createPendingProjectForOwner, listProjects } from "@/lib/server/projects-service";
import { parseJsonBody } from "@/lib/server/validation";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

const CREATE_PROJECT_LIMIT = 5;
const CREATE_PROJECT_WINDOW_MS = 60_000;

function assertMutation(request: NextRequest) {
  assertValidRequestOrigin(request, {
    allowMissingOrigin: process.env.NODE_ENV !== "production",
  });
}

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession({ projects: [] }, READ_ONLY_LOCAL_SESSION);
    }

    const { principal, session } = await getBranchMindAuthContext(request);
    const projects = await listProjects(principal.id);
    return jsonWithSession({ projects }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertMutation(request);
    const { principal, session } = await getBranchMindAuthContext(request);
    const { topic, attachments } = await parseJsonBody(
      request,
      createProjectSchema,
      {
        maxBytes: 24 * 1024,
      },
    );

    const rateLimit = await checkRateLimitAsync(request, {
      action: "create-project",
      sessionId: principal.id,
      limit: CREATE_PROJECT_LIMIT,
      windowMs: CREATE_PROJECT_WINDOW_MS,
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

    const result = await createPendingProjectForOwner(principal.id, topic, attachments);

    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
