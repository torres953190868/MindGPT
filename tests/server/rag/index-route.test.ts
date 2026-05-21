import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexDocumentForOwner } from "@/lib/server/rag/indexer";
import type { RagDocument } from "@/lib/server/rag/types";

const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_index_route", email: null, authMode: "local" },
    session: { id: "user_index_route", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/rag/indexer", () => ({
  indexDocumentForOwner: vi.fn(),
}));

function createIndexRequest(requestId = "req_index_route") {
  return new NextRequest("http://localhost/api/documents/doc_index/index", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "x-request-id": requestId,
    },
  });
}

const indexedDocument: RagDocument = {
  id: "doc_index",
  userId: "user_index_route",
  fileName: "index.pdf",
  fileUrl: null,
  storagePath: null,
  mimeType: "application/pdf",
  pageCount: 2,
  title: "Index",
  status: "indexed",
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

describe("document index route", () => {
  beforeEach(() => {
    vi.mocked(indexDocumentForOwner).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("indexes an owned document after passing the operation rate limit", async () => {
    vi.mocked(indexDocumentForOwner).mockResolvedValue({
      document: indexedDocument,
      chunkCount: 3,
      embeddingModel: "mock-embedding",
      pageCount: 2,
      sectionCount: 1,
    });
    const { POST } = await import("@/app/api/documents/[documentId]/index/route");

    const response = await POST(createIndexRequest(), {
      params: Promise.resolve({ documentId: "doc_index" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.chunkCount).toBe(3);
    expect(indexDocumentForOwner).toHaveBeenCalledWith(
      "user_index_route",
      "doc_index",
      { requestId: "req_index_route" },
    );
  });

  it("rate limits document indexing before calling the indexer", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 23,
    });
    const { POST } = await import("@/app/api/documents/[documentId]/index/route");

    const response = await POST(createIndexRequest("req_index_limited"), {
      params: Promise.resolve({ documentId: "doc_index" }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(body.error.requestId).toBe("req_index_limited");
    expect(indexDocumentForOwner).not.toHaveBeenCalled();
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "index-document",
        sessionId: "user_index_route",
      }),
    );
  });
});
