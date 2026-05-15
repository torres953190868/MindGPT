import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { indexDocumentForOwner } from "@/lib/server/rag/indexer";

type IndexRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(request: NextRequest, context: IndexRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const result = await indexDocumentForOwner(principal.id, documentId);
    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
