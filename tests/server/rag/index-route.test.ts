import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";

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

vi.mock("@/lib/server/rag/jobs", () => ({
  enqueueRagProcessingJob: vi.fn(),
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

describe("document index route", () => {
  beforeEach(() => {
    vi.mocked(enqueueRagProcessingJob).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("queues indexing for an owned document after passing the operation rate limit", async () => {
    vi.mocked(enqueueRagProcessingJob).mockResolvedValue({
      action: "index",
      documentId: "doc_index",
      messageId: "msg_index",
      requestId: "req_index_route",
      topic: "rag-document-processing",
    });
    const { POST } = await import("@/app/api/documents/[documentId]/index/route");

    const response = await POST(createIndexRequest(), {
      params: Promise.resolve({ documentId: "doc_index" }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.job).toMatchObject({
      action: "index",
      documentId: "doc_index",
      messageId: "msg_index",
    });
    expect(enqueueRagProcessingJob).toHaveBeenCalledWith(
      "user_index_route",
      "doc_index",
      "index",
      "req_index_route",
    );
  });

  it("rate limits document indexing before queueing the job", async () => {
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
    expect(enqueueRagProcessingJob).not.toHaveBeenCalled();
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "index-document",
        sessionId: "user_index_route",
      }),
    );
  });
});
