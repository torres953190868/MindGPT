import type { NextRequest } from "next/server";
import { getAgentMetricsForOwner } from "@/lib/agent-runtime/agent-observability";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { isAnyAgentEnabled } from "@/lib/server/feature-flags";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";
import type { AgentType } from "@/lib/agent-runtime/agent-run-types";

const LIMIT = 60;
const WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
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
      action: "agent-run-metrics-read",
      sessionId: principal.id,
      limit: LIMIT,
      windowMs: WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }, { requestId });
    }
    const periodDays = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 30) || 30));
    const agentTypeParam = request.nextUrl.searchParams.get("agentType");
    const agentType = agentTypeParam === "tutor" || agentTypeParam === "curriculum_builder"
      ? agentTypeParam as AgentType
      : undefined;
    const sinceIso = new Date(Date.now() - periodDays * 86_400_000).toISOString();
    const metrics = await getAgentMetricsForOwner(principal.id, { sinceIso, agentType });
    return jsonWithSession({ metrics }, session, {}, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
