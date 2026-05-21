import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";
import { queryDocumentForOwner } from "@/lib/server/rag/service";

const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_route", email: null, authMode: "local" },
    session: { id: "user_route", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  queryDocumentForOwner: vi.fn(),
}));

function createQueryRequest() {
  return new NextRequest("http://localhost/api/documents/doc_route/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify({ question: "What does the document say?" }),
  });
}

describe("document query route", () => {
  beforeEach(() => {
    vi.mocked(queryDocumentForOwner).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("refuses unindexed documents", async () => {
    vi.mocked(queryDocumentForOwner).mockRejectedValue(
      new RagError("Document is not indexed yet.", {
        code: "DOCUMENT_NOT_INDEXED",
        status: 409,
      }),
    );
    const { POST } = await import("@/app/api/documents/[documentId]/query/route");

    const response = await POST(createQueryRequest(), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("DOCUMENT_NOT_INDEXED");
  });

  it("rate limits expensive document queries before calling the service", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17,
    });
    const { POST } = await import("@/app/api/documents/[documentId]/query/route");

    const response = await POST(createQueryRequest(), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(queryDocumentForOwner).not.toHaveBeenCalled();
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "query-document",
        sessionId: "user_route",
      }),
    );
  });
});
