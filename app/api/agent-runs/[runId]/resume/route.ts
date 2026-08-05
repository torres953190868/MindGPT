import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import { curriculumBuildRequestSchema } from "@/lib/curriculum/curriculum-types";
import { getRun } from "@/lib/agent-runtime/agent-run-service";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import {
  getSafeErrorCode,
  getSafeErrorMessage,
  getSafeErrorStatus,
  jsonWithSession,
  logApiError,
  safeErrorWithSession,
} from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import {
  commitSessionCookie,
  getOrCreateSession,
  type BranchMindSession,
} from "@/lib/server/session";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";
import type { CurriculumRunResult } from "@/lib/agents/curriculum-builder/curriculum-runner";

type AgentRunResumeRouteContext = {
  params: Promise<{ runId: string }>;
};

const AGENT_RUN_WRITE_LIMIT = 30;
const AGENT_RUN_WINDOW_MS = 60_000;

const encoder = new TextEncoder();

function encodeSse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createSseResponse(
  stream: ReadableStream<Uint8Array>,
  session: BranchMindSession,
  requestId: string,
) {
  const response = new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "x-request-id": requestId,
    },
  });

  return commitSessionCookie(response, session);
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
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let result: CurriculumRunResult | undefined;
        try {
          result = await runCurriculumBuilder({
            runId,
            ownerId: principal.id,
            curriculumId: run.curriculumId!,
            request: parsedInput.data,
            idempotencyKey: newIdempotencyKey,
            runtimeMode: "inline",
            accountPlan,
            emit: (event: CurriculumStreamEvent) => {
              controller.enqueue(encodeSse(event.type, event));
            },
          });
        } catch (error) {
          const status = getSafeErrorStatus(error);
          logApiError(error, status, requestId, {
            action: "curriculum-resume",
            runId,
          });
          controller.enqueue(
            encodeSse("run_failed", {
              runId: result?.runId ?? runId,
              seq: 0,
              code: getSafeErrorCode(error, status),
              message: getSafeErrorMessage(status, error),
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return createSseResponse(stream, session, requestId);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
