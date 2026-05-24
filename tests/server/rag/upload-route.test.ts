import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";
import { uploadPdfForOwner } from "@/lib/server/rag/service";
import type { RagDocument } from "@/lib/server/rag/types";

const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_upload_route", email: null, authMode: "local" },
    session: { id: "user_upload_route", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  uploadPdfForOwner: vi.fn(),
}));

vi.mock("@/lib/server/rag/jobs", () => ({
  enqueueRagProcessingJob: vi.fn(),
}));

const uploadedDocument: RagDocument = {
  id: "doc_upload",
  userId: "user_upload_route",
  fileName: "upload.pdf",
  fileUrl: null,
  storagePath: "users/user_upload_route/doc_upload.pdf",
  mimeType: "application/pdf",
  pageCount: 0,
  title: null,
  status: "uploaded",
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

function createUploadRequest(requestId = "req_upload_route") {
  const formData = new FormData();
  formData.set(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "upload.pdf", {
      type: "application/pdf",
    }),
  );

  return new NextRequest("http://localhost/api/documents/upload", {
    body: formData,
    headers: {
      Origin: "http://localhost",
      "x-request-id": requestId,
    },
    method: "POST",
  });
}

describe("document upload route", () => {
  beforeEach(() => {
    vi.mocked(uploadPdfForOwner).mockReset();
    vi.mocked(enqueueRagProcessingJob).mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    vi.mocked(uploadPdfForOwner).mockResolvedValue(uploadedDocument);
    vi.mocked(enqueueRagProcessingJob).mockResolvedValue({
      action: "index",
      documentId: "doc_upload",
      messageId: "msg_upload",
      requestId: "req_upload_route",
      topic: "rag-document-processing",
    });
  });

  it("uploads the PDF, queues automatic indexing, and returns 202", async () => {
    const { POST } = await import("@/app/api/documents/upload/route");

    const response = await POST(createUploadRequest());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe("req_upload_route");
    expect(body.document).toMatchObject({
      id: "doc_upload",
      status: "queued",
    });
    expect(body.job).toMatchObject({
      action: "index",
      documentId: "doc_upload",
      messageId: "msg_upload",
    });
    expect(uploadPdfForOwner).toHaveBeenCalledWith(
      "user_upload_route",
      expect.any(File),
    );
    expect(enqueueRagProcessingJob).toHaveBeenCalledWith(
      "user_upload_route",
      "doc_upload",
      "index",
      "req_upload_route",
    );
  });

  it("returns enqueue failures with the upload request id", async () => {
    vi.mocked(enqueueRagProcessingJob).mockRejectedValue(
      new RagError("PDF processing could not be queued. Please retry.", {
        code: "RAG_QUEUE_ENQUEUE_FAILED",
        status: 500,
      }),
    );
    const { POST } = await import("@/app/api/documents/upload/route");

    const response = await POST(createUploadRequest("req_upload_queue_fail"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      code: "RAG_QUEUE_ENQUEUE_FAILED",
      requestId: "req_upload_queue_fail",
    });
  });
});
