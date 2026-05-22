import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import {
  CREATE_NODE_LIMIT,
  CREATE_NODE_WINDOW_MS,
  createNodeRequestSchema,
} from "@/lib/server/node-request";
import {
  createBlankChildNodeForOwner,
  createChildNodeForOwner,
  prepareChildContext,
} from "@/lib/server/projects-service";
import { getWorkspaceDocumentContextsForOwner } from "@/lib/server/rag/service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type NodesRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: NextRequest, context: NodesRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId } = await context.params;
    const body = await parseJsonBody(request, createNodeRequestSchema, {
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
      );
    }

    if ("blank" in body && body.blank) {
      const result = await createBlankChildNodeForOwner(
        principal.id,
        projectId,
        body.parentId,
        body.mode,
        body.nodeId,
      );
      return jsonWithSession(result, session);
    }

    const createBody = body as Extract<typeof body, { instruction: string }>;
    const contextData = await prepareChildContext(
      principal.id,
      projectId,
      createBody.parentId,
    );
    const documentContexts = await getWorkspaceDocumentContextsForOwner(
      principal.id,
      createBody.attachments,
      [createBody.instruction, createBody.sourceText].filter(Boolean).join("\n\n"),
    );
    const reply = await requestDeepSeekReply({
      mode: createBody.mode,
      instruction: createBody.instruction,
      contextTitles: contextData.contextSummaries,
      messages: contextData.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      sourceText: createBody.sourceText,
      documentContexts,
      modelSelection: createBody.modelSelection,
    });
    const result = await createChildNodeForOwner(
      principal.id,
      projectId,
      createBody.parentId,
      createBody.mode,
      createBody.instruction,
      reply,
      createBody.attachments,
    );

    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
