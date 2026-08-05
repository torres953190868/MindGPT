import type { NextRequest } from "next/server";
import { cancelRun } from "@/lib/agent-runtime/agent-run-service";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

type AgentRunCancelRouteContext = {
  params: Promise<{ runId: string }>;
};

const AGENT_RUN_WRITE_LIMIT = 30;
const AGENT_RUN_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: AgentRunCancelRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { runId } = await context.params;

    const rateLimit = await checkRateLimitAsync(request, {
      action: "agent-run-write",
      sessionId: principal.id,
      limit: AGENT_RUN_WRITE_LIMIT,
      windowMs: AGENT_RUN_WINDOW_MS,
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

    const run = await cancelRun(principal.id, runId);
    return jsonWithSession({ run }, session, {}, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
