import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateRequestId, withRequestIdHeader } from "@/lib/server/request";
import { commitSessionCookie, getOrCreateSession } from "@/lib/server/session";
import { getDocumentFileForOwner } from "@/lib/server/rag/service";

export const runtime = "nodejs";

type FileRouteContext = {
  params: Promise<{ documentId: string }>;
};

type ByteRange = {
  start: number;
  end: number;
};

const PDF_CACHE_CONTROL = "private, max-age=300";

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

function parseByteRange(rangeHeader: string | null, byteLength: number) {
  if (!rangeHeader) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || byteLength <= 0) return false;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return false;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;

    return {
      start: Math.max(byteLength - suffixLength, 0),
      end: byteLength - 1,
    } satisfies ByteRange;
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : byteLength - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= byteLength
  ) {
    return false;
  }

  return {
    start,
    end: Math.min(end, byteLength - 1),
  } satisfies ByteRange;
}

function createPdfBody(bytes: Uint8Array, range?: ByteRange) {
  const responseBytes = range ? bytes.slice(range.start, range.end + 1) : bytes;
  return responseBytes.slice().buffer as ArrayBuffer;
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
    const byteLength = bytes.byteLength;

    const contentType = document.mimeType || "application/pdf";
    const headers = withRequestIdHeader(
      {
        "Accept-Ranges": "bytes",
        "Cache-Control": PDF_CACHE_CONTROL,
        "Content-Disposition": encodeContentDispositionFileName(document.fileName),
        "Content-Type": contentType,
      },
      requestId,
    );
    const range = parseByteRange(request.headers.get("range"), byteLength);

    if (range === false) {
      const rangeHeaders = new Headers(headers);
      rangeHeaders.set("Content-Length", "0");
      rangeHeaders.set("Content-Range", `bytes */${byteLength}`);
      const response = new NextResponse(null, {
        status: 416,
        headers: rangeHeaders,
      });
      return commitSessionCookie(response, session);
    }

    if (range) {
      const rangeHeaders = new Headers(headers);
      rangeHeaders.set("Content-Length", String(range.end - range.start + 1));
      rangeHeaders.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${byteLength}`,
      );
      const response = new NextResponse(createPdfBody(bytes, range), {
        status: 206,
        headers: rangeHeaders,
      });
      return commitSessionCookie(response, session);
    }

    const fullHeaders = new Headers(headers);
    fullHeaders.set("Content-Length", String(byteLength));
    const response = new NextResponse(createPdfBody(bytes), {
      headers: fullHeaders,
    });

    return commitSessionCookie(response, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
