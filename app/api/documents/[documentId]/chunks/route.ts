import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import { getDocumentChunksForOwner } from "@/lib/server/rag/service";

type ChunksRouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function GET(request: NextRequest, context: ChunksRouteContext) {
  const fallbackSession = getOrCreateSession(request);

  try {
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const chunks = await getDocumentChunksForOwner(principal.id, documentId);
    return jsonWithSession({
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        headingPath: chunk.headingPath,
        tokenCount: chunk.tokenCount,
        content: chunk.content,
        metadata: chunk.metadata,
      })),
    }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
