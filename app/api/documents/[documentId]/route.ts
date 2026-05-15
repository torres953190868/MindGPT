import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import { getDocumentDetailsForOwner } from "@/lib/server/rag/service";

type DocumentRouteContext = {
  params: Promise<{ documentId: string }>;
};

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
