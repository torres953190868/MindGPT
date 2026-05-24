import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";

type IndexRouteContext = {
  params: Promise<{ documentId: string }>;
};

const INDEX_DOCUMENT_LIMIT = 5;
const INDEX_DOCUMENT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: IndexRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "index-document",
      sessionId: principal.id,
      limit: INDEX_DOCUMENT_LIMIT,
      windowMs: INDEX_DOCUMENT_WINDOW_MS,
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

    const job = await enqueueRagProcessingJob(principal.id, documentId, "index", requestId);
    return jsonWithSession(
      { job },
      session,
      { status: 202 },
      { requestId },
    );
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
