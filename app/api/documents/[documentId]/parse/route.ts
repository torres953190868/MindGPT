import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseDocumentForOwner } from "@/lib/server/rag/indexer";

type ParseRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(request: NextRequest, context: ParseRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const result = await parseDocumentForOwner(principal.id, documentId, {
      requestId,
    });
    return jsonWithSession(result, session, undefined, { requestId });
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
