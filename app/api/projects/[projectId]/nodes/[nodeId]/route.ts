import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import {
  deleteNodeForOwner,
  updateNodeForOwner,
} from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type NodeRouteContext = {
  params: Promise<{ projectId: string; nodeId: string }>;
};

const updateNodeSchema = z.object({
  position: z
    .object({
      x: z.number().finite().min(-100_000).max(100_000),
      y: z.number().finite().min(-100_000).max(100_000),
    })
    .optional(),
  collapsed: z.boolean().optional(),
});

const PATCH_NODE_LIMIT = 120;
const DELETE_NODE_LIMIT = 40;
const NODE_WINDOW_MS = 60_000;

async function assertNodeRateLimit(
  request: NextRequest,
  sessionId: string,
  action: string,
  limit: number,
) {
  return checkRateLimitAsync(request, {
    action,
    sessionId,
    limit,
    windowMs: NODE_WINDOW_MS,
  });
}

export async function PATCH(request: NextRequest, context: NodeRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId, nodeId } = await context.params;
    const body = await parseJsonBody(request, updateNodeSchema, {
      maxBytes: 4 * 1024,
    });
    const rateLimit = await assertNodeRateLimit(
      request,
      principal.id,
      "patch-node",
      PATCH_NODE_LIMIT,
    );

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

    const project = await updateNodeForOwner(principal.id, projectId, nodeId, body);
    return jsonWithSession({ project }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function DELETE(request: NextRequest, context: NodeRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { projectId, nodeId } = await context.params;
    const rateLimit = await assertNodeRateLimit(
      request,
      principal.id,
      "delete-node",
      DELETE_NODE_LIMIT,
    );

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

    const result = await deleteNodeForOwner(principal.id, projectId, nodeId);
    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
