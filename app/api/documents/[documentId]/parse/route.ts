import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";

type ParseRouteContext = {
  params: Promise<{ documentId: string }>;
};

const PARSE_DOCUMENT_LIMIT = 10;
const PARSE_DOCUMENT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: ParseRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const rateLimit = await checkRateLimitAsync(request, {
      action: "parse-document",
      sessionId: principal.id,
      limit: PARSE_DOCUMENT_LIMIT,
      windowMs: PARSE_DOCUMENT_WINDOW_MS,
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

    const job = await enqueueRagProcessingJob(principal.id, documentId, "parse", requestId);
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
