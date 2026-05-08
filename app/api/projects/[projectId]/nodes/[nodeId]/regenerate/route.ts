import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { streamDeepSeekReply } from "@/lib/server/deepseek-streaming";
import {
  getSafeErrorMessage,
  getSafeErrorStatus,
  jsonWithSession,
  safeErrorWithSession,
} from "@/lib/server/http";
import {
  CREATE_NODE_LIMIT,
  CREATE_NODE_WINDOW_MS,
  regenerateNodeSchema,
} from "@/lib/server/node-request";
import {
  prepareRegenerateNodeContext,
  regenerateNodeForOwner,
} from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import {
  commitSessionCookie,
  getOrCreateSession,
  type BranchMindSession,
} from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type RegenerateNodeRouteContext = {
  params: Promise<{ projectId: string; nodeId: string }>;
};

const encoder = new TextEncoder();

function encodeSse(event: "delta" | "complete" | "error", data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createSseResponse(stream: ReadableStream<Uint8Array>, session: BranchMindSession) {
  const response = new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });

  return commitSessionCookie(response, session);
}

export async function POST(request: NextRequest, context: RegenerateNodeRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId, nodeId } = await context.params;
    const body = await parseJsonBody(request, regenerateNodeSchema, {
      maxBytes: 8 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "regenerate-node",
      sessionId: principal.id,
      limit: CREATE_NODE_LIMIT,
      windowMs: CREATE_NODE_WINDOW_MS,
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

    const contextData = await prepareRegenerateNodeContext(
      principal.id,
      projectId,
      nodeId,
      body,
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of streamDeepSeekReply({
            mode: contextData.mode,
            instruction: contextData.instruction,
            contextTitles: contextData.contextSummaries,
            messages: contextData.messages.map(({ role, content }) => ({
              role,
              content,
            })),
          })) {
            if (event.type === "delta") {
              controller.enqueue(encodeSse("delta", {
                contentDelta: event.contentDelta,
              }));
              continue;
            }

            const result = await regenerateNodeForOwner(
              principal.id,
              projectId,
              nodeId,
              {
                instruction: body.instruction,
                userMessageId: body.userMessageId,
                assistantMessageId: body.assistantMessageId,
                reply: event.reply,
              },
            );
            controller.enqueue(encodeSse("complete", result));
          }
        } catch (error) {
          controller.enqueue(encodeSse("error", {
            message: getSafeErrorMessage(getSafeErrorStatus(error), error),
          }));
        } finally {
          controller.close();
        }
      },
    });

    return createSseResponse(stream, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
