import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import {
  CREATE_NODE_LIMIT,
  CREATE_NODE_WINDOW_MS,
  createNodeSchema,
} from "@/lib/server/node-request";
import {
  createChildNodeForOwner,
  prepareChildContext,
} from "@/lib/server/projects-service";
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
      );
    }

    const contextData = await prepareChildContext(
      principal.id,
      projectId,
      body.parentId,
    );
    const reply = await requestDeepSeekReply({
      mode: body.mode,
      instruction: body.instruction,
      contextTitles: contextData.contextSummaries,
      messages: contextData.parent.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      sourceText: body.sourceText,
    });
    const result = await createChildNodeForOwner(
      principal.id,
      projectId,
      body.parentId,
      body.mode,
      body.instruction,
      reply,
    );

    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
