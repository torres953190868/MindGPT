import type { NextRequest } from "next/server";
import { getRun } from "@/lib/agent-runtime/agent-run-service";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

type AgentRunRouteContext = {
  params: Promise<{ runId: string }>;
};

const AGENT_RUN_READ_LIMIT = 120;
const AGENT_RUN_WINDOW_MS = 60_000;

export async function GET(request: NextRequest, context: AgentRunRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const { runId } = await context.params;

    const rateLimit = await checkRateLimitAsync(request, {
      action: "agent-run-read",
      sessionId: principal.id,
      limit: AGENT_RUN_READ_LIMIT,
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

    const run = await getRun(principal.id, runId);
    return jsonWithSession({ run }, session, {}, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
