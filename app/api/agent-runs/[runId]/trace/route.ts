import type { NextRequest } from "next/server";
import { getAgentTraceForOwner } from "@/lib/agent-runtime/agent-observability";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { isAnyAgentEnabled } from "@/lib/server/feature-flags";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);
  try {
    if (!isAnyAgentEnabled()) {
      throw new HttpError("Resource not found.", {
        code: "NOT_FOUND",
        expose: true,
        status: 404,
      });
    }
    const { principal, session } = await getBranchMindAuthContext(request);
    const rateLimit = await checkRateLimitAsync(request, {
      action: "agent-run-trace-read",
      sessionId: principal.id,
      limit: 60,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }, { requestId });
    }
    const { runId } = await context.params;
    const trace = await getAgentTraceForOwner(principal.id, runId);
    if (!trace) return jsonWithSession({ error: "Agent run not found." }, session, { status: 404 }, { requestId });
    return jsonWithSession({ trace }, session, {}, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
