import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { createProjectForOwner, listProjects } from "@/lib/server/projects-service";
import { parseJsonBody } from "@/lib/server/validation";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";

const createProjectSchema = z.object({
  topic: z.string().trim().min(1).max(600),
});

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
    const { topic } = await parseJsonBody(request, createProjectSchema, {
      maxBytes: 8 * 1024,
    });

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

    const reply = await requestDeepSeekReply({
      mode: "root",
      instruction: topic,
    });
    const result = await createProjectForOwner(principal.id, topic, reply);

    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
