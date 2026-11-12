import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { trackDailyAiMessageUsage } from "@/lib/server/ai-usage";
import { getWorkspaceCurriculumContextsForOwner } from "@/lib/server/curriculum-context";
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
  appendNodeMessageSchema,
  CREATE_NODE_LIMIT,
  CREATE_NODE_WINDOW_MS,
} from "@/lib/server/node-request";
import {
  appendNodeMessageForOwner,
  prepareAppendNodeMessageContext,
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
import {
  recordCanvasTurnMemoryForOwner,
  resolveUserMemorySlotForOwner,
} from "@/lib/server/user-memory";
import { parseJsonBody } from "@/lib/server/validation";

type AppendNodeMessageStreamRouteContext = {
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

export async function POST(
  request: NextRequest,
  context: AppendNodeMessageStreamRouteContext,
) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId, nodeId } = await context.params;
    const body = await parseJsonBody(request, appendNodeMessageSchema, {
      maxBytes: 24 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "append-node-message",
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

    // Counts one AI message per request and enforces the plan's daily limit
    // before streaming starts. Fails open when usage tracking is unavailable.
    await trackDailyAiMessageUsage(principal);

    const userPlan = await getAccountPlanForModelAccess(principal);
    const contextData = await prepareAppendNodeMessageContext(
      principal.id,
      projectId,
      nodeId,
      body,
    );
    const explicitAttachments = contextData.attachments ?? body.attachments;
    const effectiveInstruction = contextData.instruction ?? body.instruction;
    const fallbackQuery = [effectiveInstruction, body.sourceText]
      .filter(Boolean)
      .join("\n\n");
    const retrievalQuery = contextData.retrievalQuery ?? fallbackQuery;
    const inheritedContextOptions = contextData.inheritedAttachments?.length
      ? { inheritedAttachments: contextData.inheritedAttachments }
      : undefined;
    const documentContexts = inheritedContextOptions
      ? await getWorkspaceDocumentContextsForOwner(
          principal.id,
          explicitAttachments,
          retrievalQuery,
          inheritedContextOptions,
        )
      : await getWorkspaceDocumentContextsForOwner(
          principal.id,
          explicitAttachments,
          retrievalQuery,
        );
    const curriculumContexts = inheritedContextOptions
      ? await getWorkspaceCurriculumContextsForOwner(
          principal.id,
          explicitAttachments,
          retrievalQuery,
          inheritedContextOptions,
        )
      : await getWorkspaceCurriculumContextsForOwner(
          principal.id,
          explicitAttachments,
          retrievalQuery,
        );
    const userMemory = await resolveUserMemorySlotForOwner(
      principal.id,
      retrievalQuery,
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
            sourceText: body.sourceText,
            documentContexts,
            curriculumContexts,
            modelSelection: body.modelSelection,
            userPlan,
            skill: body.skill,
            treeContext: contextData.treeContext,
            ...(userMemory ? { userMemory } : {}),
          })) {
            if (event.type === "delta") {
              controller.enqueue(
                encodeSse("delta", {
                  contentDelta: event.contentDelta,
                }),
              );
              continue;
            }

            const result = await appendNodeMessageForOwner(
              principal.id,
              projectId,
              nodeId,
              {
                instruction: effectiveInstruction,
                reply: event.reply,
                attachments: explicitAttachments,
                expectedNodeUpdatedAt: body.expectedNodeUpdatedAt,
              },
            );
            controller.enqueue(encodeSse("complete", result));
            await recordCanvasTurnMemoryForOwner({
              ownerId: principal.id,
              projectId,
              nodeId: result.node.id,
              mode: contextData.mode,
              instruction: effectiveInstruction,
              sourceText: body.sourceText,
              reply: event.reply,
              contextSummaries: contextData.contextSummaries,
            });
          }
        } catch (error) {
          const status = getSafeErrorStatus(error);
          logApiError(error, status, requestId, {
            action: "append-node-message",
            nodeId,
            projectId,
          });
          controller.enqueue(
            encodeSse("error", {
              code: getSafeErrorCode(error, status),
              message: getSafeErrorMessage(status, error),
              requestId,
              status,
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
