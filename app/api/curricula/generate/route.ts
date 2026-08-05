import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateCurriculumDraft } from "@/lib/agents/curriculum-builder/curriculum-builder-agent";
import { CURRICULUM_LIMITS, curriculumBuildRequestSchema } from "@/lib/curriculum/curriculum-types";
import { getCurriculumForOwner } from "@/lib/curriculum/curriculum-service";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import {
  getSafeErrorCode,
  getSafeErrorMessage,
  getSafeErrorStatus,
  HttpError,
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
import { parseJsonBody } from "@/lib/server/validation";
import { assertMonthlyCurriculumGenerationQuota } from "@/lib/server/curriculum-generation-quota";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";
import type { CurriculumRunResult } from "@/lib/agents/curriculum-builder/curriculum-runner";

const generateCurriculumSchema = curriculumBuildRequestSchema.extend({
  curriculumId: z.string().trim().min(1).max(CURRICULUM_LIMITS.maxClientIdLength),
});

const GENERATE_LIMIT = 10;
const GENERATE_WINDOW_MS = 60_000;
const BODY_MAX_BYTES = 64 * 1024;

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

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertCurriculumAgentEnabled();

    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, generateCurriculumSchema, {
      maxBytes: BODY_MAX_BYTES,
    });
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey) {
      throw new HttpError("Idempotency-Key header is required for curriculum generation.", {
        code: "IDEMPOTENCY_KEY_REQUIRED",
        expose: true,
        status: 400,
      });
    }

    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-generate",
      sessionId: principal.id,
      limit: GENERATE_LIMIT,
      windowMs: GENERATE_WINDOW_MS,
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

    const accountPlan = await getAccountPlanForModelAccess(principal);
    await assertMonthlyCurriculumGenerationQuota({ ...principal, plan: accountPlan });

    // Ownership check (404 if missing or foreign-owned).
    const curriculum = await getCurriculumForOwner(principal.id, body.curriculumId);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let result: CurriculumRunResult | undefined;
        try {
          result = await generateCurriculumDraft({
            ownerId: principal.id,
            curriculumId: body.curriculumId,
            projectId: curriculum.projectId ?? undefined,
            request: {
              subject: body.subject,
              learnerProfile: body.learnerProfile,
              learningGoal: body.learningGoal,
              constraints: body.constraints,
              sourcePreferences: body.sourcePreferences,
            },
            idempotencyKey,
            runtimeMode: "inline",
            accountPlan,
            emit: (event: CurriculumStreamEvent) => {
              controller.enqueue(encodeSse(event.type, event));
            },
          });
        } catch (error) {
          // The runner normally emits its own terminal events; this catch
          // covers unexpected errors that bypass runner event emission.
          const status = getSafeErrorStatus(error);
          logApiError(error, status, requestId, {
            action: "curriculum-generate",
            curriculumId: body.curriculumId,
          });
          controller.enqueue(
            encodeSse("run_failed", {
              runId: result?.runId ?? "",
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
