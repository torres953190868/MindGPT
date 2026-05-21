import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { streamDeepSeekReply } from "@/lib/server/deepseek-streaming";
import {
  getSafeErrorMessage,
  getSafeErrorCode,
  getSafeErrorStatus,
  jsonWithSession,
  logApiError,
  safeErrorWithSession,
} from "@/lib/server/http";
import {
  CREATE_NODE_LIMIT,
  CREATE_NODE_WINDOW_MS,
  createNodeSchema,
} from "@/lib/server/node-request";
import {
  createChildNodeForOwner,
  prepareChildContext,
} from "@/lib/server/projects-service";
import { getWorkspaceDocumentContextsForOwner } from "@/lib/server/rag/service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import {
  commitSessionCookie,
  getOrCreateSession,
  type BranchMindSession,
} from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type NodesStreamRouteContext = {
  params: Promise<{ projectId: string }>;
};

const encoder = new TextEncoder();

function encodeSse(event: "delta" | "complete" | "error", data: unknown) {
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

export async function POST(request: NextRequest, context: NodesStreamRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const body = await parseJsonBody(request, createNodeSchema, {
      maxBytes: 24 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "create-node",
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
        { requestId },
      );
    }

    const contextData = await prepareChildContext(
      principal.id,
      projectId,
      body.parentId,
    );
    const documentContexts = await getWorkspaceDocumentContextsForOwner(
      principal.id,
      body.attachments,
      [body.instruction, body.sourceText].filter(Boolean).join("\n\n"),
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of streamDeepSeekReply({
            mode: body.mode,
            instruction: body.instruction,
            contextTitles: contextData.contextSummaries,
            messages: contextData.messages.map(({ role, content }) => ({
              role,
              content,
            })),
            sourceText: body.sourceText,
            documentContexts,
            modelSelection: body.modelSelection,
          })) {
            if (event.type === "delta") {
              controller.enqueue(encodeSse("delta", {
                contentDelta: event.contentDelta,
              }));
              continue;
            }

            const result = await createChildNodeForOwner(
              principal.id,
              projectId,
              body.parentId,
              body.mode,
              body.instruction,
              event.reply,
              body.attachments,
            );
            controller.enqueue(encodeSse("complete", result));
          }
        } catch (error) {
          const status = getSafeErrorStatus(error);
          logApiError(error, status, requestId, {
            action: "stream-node",
            projectId,
          });
          controller.enqueue(encodeSse("error", {
            code: getSafeErrorCode(error, status),
            message: getSafeErrorMessage(status, error),
            requestId,
            status,
          }));
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
