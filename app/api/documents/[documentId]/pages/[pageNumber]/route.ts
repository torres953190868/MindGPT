import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import { RagError } from "@/lib/server/rag/errors";
import { getDocumentPageForOwner } from "@/lib/server/rag/service";

type PageRouteContext = {
  params: Promise<{ documentId: string; pageNumber: string }>;
};

export async function GET(request: NextRequest, context: PageRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId, pageNumber: rawPageNumber } = await context.params;
    const pageNumber = Number(rawPageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      throw new RagError("Page number must be a positive integer.", {
        code: "INVALID_PAGE_NUMBER",
        status: 400,
      });
    }

    const page = await getDocumentPageForOwner(principal.id, documentId, pageNumber);
    return jsonWithSession({ page }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
