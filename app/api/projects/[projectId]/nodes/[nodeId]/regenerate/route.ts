import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
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
  regenerateNodeSchema,
} from "@/lib/server/node-request";
import {
  prepareRegenerateNodeContext,
  regenerateNodeForOwner,
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

type RegenerateNodeRouteContext = {
  params: Promise<{ projectId: string; nodeId: string }>;
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

export async function POST(request: NextRequest, context: RegenerateNodeRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

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
        { requestId },
      );
    }

    const userPlan = await getAccountPlanForModelAccess(principal);
    const contextData = await prepareRegenerateNodeContext(
      principal.id,
      projectId,
      nodeId,
      body,
    );
    const documentContexts = await getWorkspaceDocumentContextsForOwner(
      principal.id,
      contextData.attachments,
      contextData.instruction,
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of streamDeepSeekReply({
            llmTask: "node_generation",
            mode: contextData.mode,
            instruction: contextData.instruction,
            contextTitles: contextData.contextSummaries,
            messages: contextData.messages.map(({ role, content }) => ({
              role,
              content,
            })),
            documentContexts,
            modelSelection: body.modelSelection,
            userPlan,
            skill: body.skill,
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
                expectedNodeUpdatedAt: body.expectedNodeUpdatedAt,
                reply: event.reply,
              },
            );
            controller.enqueue(encodeSse("complete", result));
          }
        } catch (error) {
          const status = getSafeErrorStatus(error);
          logApiError(error, status, requestId, {
            action: "regenerate-node",
            nodeId,
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
