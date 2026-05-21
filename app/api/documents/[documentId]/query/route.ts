import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";
import { queryDocumentForOwner } from "@/lib/server/rag/service";

type QueryRouteContext = {
  params: Promise<{ documentId: string }>;
};

const querySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(50).optional(),
});

const QUERY_DOCUMENT_LIMIT = 30;
const QUERY_DOCUMENT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: QueryRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const body = await parseJsonBody(request, querySchema, {
      maxBytes: 8 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "query-document",
      sessionId: principal.id,
      limit: QUERY_DOCUMENT_LIMIT,
      windowMs: QUERY_DOCUMENT_WINDOW_MS,
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

    const result = await queryDocumentForOwner(
      principal.id,
      documentId,
      body.question,
      body.topK,
    );
    return jsonWithSession(result, session, undefined, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
