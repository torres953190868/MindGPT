import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";

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

vi.mock("@/lib/server/rag/jobs", () => ({
  enqueueRagProcessingJob: vi.fn(),
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
    vi.mocked(enqueueRagProcessingJob).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("queues parsing for an owned document and returns the request id", async () => {
    vi.mocked(enqueueRagProcessingJob).mockResolvedValue({
      action: "parse",
      documentId: "doc_parse",
      messageId: "msg_parse",
      requestId: "req_parse_route",
      topic: "rag-document-processing",
    });
    const { POST } = await import("@/app/api/documents/[documentId]/parse/route");

    const response = await POST(createParseRequest(), {
      params: Promise.resolve({ documentId: "doc_parse" }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe("req_parse_route");
    expect(body.job).toMatchObject({
      action: "parse",
      documentId: "doc_parse",
      messageId: "msg_parse",
    });
    expect(enqueueRagProcessingJob).toHaveBeenCalledWith(
      "user_parse_route",
      "doc_parse",
      "parse",
      "req_parse_route",
    );
  });

  it("returns queueing failures with a stable request id", async () => {
    vi.mocked(enqueueRagProcessingJob).mockRejectedValue(
      new RagError("Document was not found.", {
        code: "DOCUMENT_NOT_FOUND",
        status: 404,
      }),
    );
    const { POST } = await import("@/app/api/documents/[documentId]/parse/route");

    const response = await POST(createParseRequest("req_parse_fail"), {
      params: Promise.resolve({ documentId: "doc_parse" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBe("req_parse_fail");
    expect(body.error).toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      requestId: "req_parse_fail",
    });
  });
});
