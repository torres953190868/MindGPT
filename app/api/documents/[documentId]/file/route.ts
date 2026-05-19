import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId, withRequestIdHeader } from "@/lib/server/request";
import { commitSessionCookie, getOrCreateSession } from "@/lib/server/session";
import { getDocumentFileForOwner } from "@/lib/server/rag/service";

type FileRouteContext = {
  params: Promise<{ documentId: string }>;
};

function encodeContentDispositionFileName(fileName: string) {
  const cleaned = fileName.replace(/[\r\n]/g, "_").trim() || "document.pdf";
  const asciiFallback =
    cleaned
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "_")
      .trim() || "document.pdf";

  if (cleaned === asciiFallback) {
    return `inline; filename="${asciiFallback}"`;
  }

  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest, context: FileRouteContext) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    const { principal, session } = await getBranchMindAuthContext(request);
    const { documentId } = await context.params;
    const { document, bytes } = await getDocumentFileForOwner(
      principal.id,
      documentId,
    );

    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const response = new NextResponse(body, {
      headers: withRequestIdHeader(
        {
          "Cache-Control": "no-store",
          "Content-Disposition": encodeContentDispositionFileName(
            document.fileName,
          ),
          "Content-Type": document.mimeType || "application/pdf",
        },
        requestId,
      ),
    });

    return commitSessionCookie(response, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
