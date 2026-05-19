import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { updateDocumentSchema } from "@/lib/server/rag/request";
import { getOrCreateSession } from "@/lib/server/session";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { parseJsonBody } from "@/lib/server/validation";
import {
  deleteDocumentForOwner,
  getDocumentDetailsForOwner,
  renameDocumentForOwner,
} from "@/lib/server/rag/service";

type DocumentRouteContext = {
  params: Promise<{ documentId: string }>;
};

const PATCH_DOCUMENT_LIMIT = 120;
const DELETE_DOCUMENT_LIMIT = 20;
const DOCUMENT_WINDOW_MS = 60_000;

async function assertDocumentRateLimit(
  request: NextRequest,
  sessionId: string,
  action: string,
  limit: number,
) {
  return checkRateLimitAsync(request, {
    action,
    sessionId,
    limit,
    windowMs: DOCUMENT_WINDOW_MS,
  });
}

export async function GET(request: NextRequest, context: DocumentRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const details = await getDocumentDetailsForOwner(principal.id, documentId);
    return jsonWithSession(details, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function PATCH(request: NextRequest, context: DocumentRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const body = await parseJsonBody(request, updateDocumentSchema, {
      maxBytes: 4 * 1024,
    });
    const rateLimit = await assertDocumentRateLimit(
      request,
      principal.id,
      "patch-document",
      PATCH_DOCUMENT_LIMIT,
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

    const document = await renameDocumentForOwner(principal.id, documentId, body.name);
    return jsonWithSession({ document }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function DELETE(request: NextRequest, context: DocumentRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const rateLimit = await assertDocumentRateLimit(
      request,
      principal.id,
      "delete-document",
      DELETE_DOCUMENT_LIMIT,
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

    const documents = await deleteDocumentForOwner(principal.id, documentId);
    return jsonWithSession({ documents }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
