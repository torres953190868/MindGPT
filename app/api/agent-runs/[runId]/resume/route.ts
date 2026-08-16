import type { NextRequest } from "next/server";
import { send } from "@vercel/queue";
import {
  CURRICULUM_PROCESSING_TOPIC,
  type CurriculumProcessingJob,
} from "@/lib/agents/curriculum-builder/curriculum-jobs";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import { getRun, resumeRun } from "@/lib/agent-runtime/agent-run-service";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import { curriculumBuildRequestSchema } from "@/lib/curriculum/curriculum-types";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import {
  getSafeErrorStatus,
  jsonWithSession,
  logApiError,
  safeErrorWithSession,
} from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";

type AgentRunResumeRouteContext = {
  params: Promise<{ runId: string }>;
};

const AGENT_RUN_WRITE_LIMIT = 30;
const AGENT_RUN_WINDOW_MS = 60_000;

// Mirrors BRANCHMIND_RAG_QUEUE_MODE: queue workers in production, detached
// inline execution in dev where no queue infrastructure is running.
function getCurriculumQueueMode() {
  const value = process.env.BRANCHMIND_CURRICULUM_QUEUE_MODE?.trim().toLowerCase();
  if (value === "inline" || value === "queue") return value;
  return process.env.NODE_ENV === "development" ? "inline" : "queue";
}

export async function POST(request: NextRequest, context: AgentRunResumeRouteContext) {
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

    const newIdempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!newIdempotencyKey) {
      return jsonWithSession(
        { error: "Idempotency-Key header is required for resume." },
        session,
        { status: 400 },
        { requestId },
      );
    }

    const run = await getRun(principal.id, runId);
    if (run.status !== "failed" && run.status !== "cancelled") {
      return jsonWithSession(
        { error: "Run can only be resumed from failed or cancelled state." },
        session,
        { status: 409 },
        { requestId },
      );
    }

    const parsedInput = curriculumBuildRequestSchema.safeParse(run.input);
    if (!parsedInput.success) {
      return jsonWithSession(
        { error: "Run input is not a valid curriculum build request." },
        session,
        { status: 422 },
        { requestId },
      );
    }

    const accountPlan = await getAccountPlanForModelAccess(principal);

    // Transitions failed/cancelled -> queued before any execution kicks off,
    // so polling clients never observe the old terminal status. A retried
    // resume with a fresh key 409s here once the run is active again.
    const resumed = await resumeRun(principal.id, runId, newIdempotencyKey);

    if (getCurriculumQueueMode() === "queue") {
      const job: CurriculumProcessingJob = {
        runId,
        ownerId: principal.id,
        curriculumId: run.curriculumId!,
        request: parsedInput.data,
        requestId,
        accountPlan: accountPlan ?? null,
      };
      await send(CURRICULUM_PROCESSING_TOPIC, job, {
        headers: { "x-request-id": requestId },
        retentionSeconds: 24 * 60 * 60,
      });
    } else {
      // Dev-only inline execution: detached so the route can return 202
      // immediately; the runner persists run_failed events on its own.
      void runCurriculumBuilder({
        runId,
        ownerId: principal.id,
        curriculumId: run.curriculumId!,
        request: parsedInput.data,
        idempotencyKey: newIdempotencyKey,
        runtimeMode: "inline",
        accountPlan,
      }).catch((error: unknown) => {
        logApiError(error, getSafeErrorStatus(error), requestId, {
          action: "curriculum-resume",
          runId,
        });
      });
    }

    return jsonWithSession(
      { runId: resumed.run.id, status: resumed.run.status },
      session,
      { status: 202 },
      { requestId },
    );
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
