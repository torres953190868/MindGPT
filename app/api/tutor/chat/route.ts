import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tutorActionSchema } from "@/lib/learning/learning-types";
import { assertTutorAgentEnabled, chatWithTutorForOwner } from "@/lib/learning/learning-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { commitSessionCookie, getOrCreateSession, type BranchMindSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

const tutorChatSchema = z.object({
  enrollmentId: z.string().trim().min(1).max(160),
  skillId: z.string().trim().min(1).max(160).optional(),
  targetNodeId: z.string().trim().min(1).max(160).optional(),
  action: tutorActionSchema.optional(),
  message: z.string().trim().max(8_000).optional(),
});

const encoder = new TextEncoder();

function encodeTutorEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createTutorSseResponse(
  result: Awaited<ReturnType<typeof chatWithTutorForOwner>>,
  session: BranchMindSession,
  requestId: string,
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of result.response.blocks) {
        const event = block.type === "exercise"
          ? "exercise"
          : block.type === "source"
            ? "source"
            : "lesson-block";
        controller.enqueue(encodeTutorEvent(event, { type: event, block }));
      }
      if (result.response.progressProposal) {
        controller.enqueue(encodeTutorEvent("progress-proposal", {
          type: "progress-proposal",
          progressProposal: result.response.progressProposal,
        }));
      }
      controller.enqueue(encodeTutorEvent("complete", {
        type: "complete",
        payload: result,
      }));
      controller.close();
    },
  });
  return commitSessionCookie(new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "x-request-id": requestId,
    },
  }), session);
}

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);
  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    assertTutorAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const body = await parseJsonBody(request, tutorChatSchema, { maxBytes: 64 * 1024 });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "tutor-chat",
      sessionId: principal.id,
      limit: 10,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }
    const result = await chatWithTutorForOwner(principal.id, body);
    return createTutorSseResponse(result, session, requestId);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
