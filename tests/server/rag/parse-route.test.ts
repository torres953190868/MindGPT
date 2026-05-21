import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";
import { parseDocumentForOwner } from "@/lib/server/rag/indexer";
import type { RagDocument } from "@/lib/server/rag/types";

const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_parse_route", email: null, authMode: "local" },
    session: { id: "user_parse_route", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/rag/indexer", () => ({
  parseDocumentForOwner: vi.fn(),
}));

function createParseRequest(requestId = "req_parse_route") {
  return new NextRequest("http://localhost/api/documents/doc_parse/parse", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "x-request-id": requestId,
    },
  });
}

describe("document parse route", () => {
  beforeEach(() => {
    vi.mocked(parseDocumentForOwner).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("parses an owned document and returns the request id", async () => {
    const parsedDocument: RagDocument = {
      id: "doc_parse",
      userId: "user_parse_route",
      fileName: "parse.pdf",
      fileUrl: null,
      storagePath: null,
      mimeType: "application/pdf",
      pageCount: 2,
      title: "Parsed",
      status: "parsed",
      parserVersion: "pdf-text-v1",
      chunkVersion: "heading-recursive-v1",
      errorMessage: null,
      errorCode: null,
      errorStage: null,
      errorRequestId: null,
      errorDetails: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(parseDocumentForOwner).mockResolvedValue({
      document: parsedDocument,
      pageCount: 2,
      sectionCount: 1,
    });
    const { POST } = await import("@/app/api/documents/[documentId]/parse/route");

    const response = await POST(createParseRequest(), {
      params: Promise.resolve({ documentId: "doc_parse" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_parse_route");
    expect(body).toMatchObject({ pageCount: 2, sectionCount: 1 });
    expect(parseDocumentForOwner).toHaveBeenCalledWith(
      "user_parse_route",
      "doc_parse",
      { requestId: "req_parse_route" },
    );
  });

  it("returns parse failures with a stable request id", async () => {
    vi.mocked(parseDocumentForOwner).mockRejectedValue(
      new RagError("This PDF does not contain enough selectable text.", {
        code: "PDF_TEXT_EMPTY",
        status: 422,
      }),
    );
    const { POST } = await import("@/app/api/documents/[documentId]/parse/route");

    const response = await POST(createParseRequest("req_parse_fail"), {
      params: Promise.resolve({ documentId: "doc_parse" }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get("x-request-id")).toBe("req_parse_fail");
    expect(body.error).toMatchObject({
      code: "PDF_TEXT_EMPTY",
      requestId: "req_parse_fail",
    });
  });
});
