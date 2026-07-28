import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";

const sendMock = vi.hoisted(() => vi.fn());
const handleCallbackMock = vi.hoisted(() => vi.fn());
const parseDocumentForOwnerMock = vi.hoisted(() => vi.fn());
const indexDocumentForOwnerMock = vi.hoisted(() => vi.fn());
const repositoryMock = vi.hoisted(() => ({
  setDocumentStatus: vi.fn(),
}));
const requireOwnedDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/queue", () => ({
  handleCallback: handleCallbackMock,
  send: sendMock,
}));

vi.mock("@/lib/server/rag/indexer", () => ({
  indexDocumentForOwner: indexDocumentForOwnerMock,
  parseDocumentForOwner: parseDocumentForOwnerMock,
}));

vi.mock("@/lib/server/rag/store", () => ({
  getRagRepository: () => repositoryMock,
  requireOwnedDocument: requireOwnedDocumentMock,
}));

describe("rag processing jobs", () => {
  beforeEach(() => {
    sendMock.mockReset();
    handleCallbackMock.mockReset();
    handleCallbackMock.mockImplementation((handler) => handler);
    parseDocumentForOwnerMock.mockReset();
    indexDocumentForOwnerMock.mockReset();
    repositoryMock.setDocumentStatus.mockReset();
    requireOwnedDocumentMock.mockReset();
    requireOwnedDocumentMock.mockResolvedValue({
      id: "doc_job",
      status: "uploaded",
    });
    sendMock.mockResolvedValue({ messageId: "msg_job" });
    vi.resetModules();
  });

  it("validates queue job payloads", async () => {
    const { parseRagProcessingJob } = await import("@/lib/server/rag/jobs");

    expect(
      parseRagProcessingJob({
        action: "index",
        documentId: " doc_job ",
        requestId: " req_job ",
        userId: " user_job ",
      }),
    ).toEqual({
      action: "index",
      documentId: "doc_job",
      requestId: "req_job",
      userId: "user_job",
    });
    expect(() => parseRagProcessingJob({ action: "delete" })).toThrow(
      /action must be parse or index/,
    );
  });

  it("marks a document queued before publishing the processing job", async () => {
    const { enqueueRagProcessingJob } = await import("@/lib/server/rag/jobs");

    const job = await enqueueRagProcessingJob(
      "user_job",
      "doc_job",
      "index",
      "req_job",
    );

    expect(repositoryMock.setDocumentStatus).toHaveBeenCalledWith(
      "doc_job",
      "queued",
      expect.objectContaining({
        errorMessage: null,
        parserVersion: "pdf-text-v1",
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      "rag-document-processing",
      {
        action: "index",
        documentId: "doc_job",
        requestId: "req_job",
        userId: "user_job",
      },
      expect.objectContaining({
        idempotencyKey: "index:doc_job:req_job",
      }),
    );
    expect(job).toMatchObject({
      action: "index",
      documentId: "doc_job",
      messageId: "msg_job",
      topic: "rag-document-processing",
    });
  });

  it("marks enqueue failures on the document and rethrows", async () => {
    vi.stubEnv("BRANCHMIND_RAG_QUEUE_MODE", "queue");
    sendMock.mockRejectedValue(new Error("queue unavailable"));
    const { enqueueRagProcessingJob } = await import("@/lib/server/rag/jobs");

    await expect(
      enqueueRagProcessingJob("user_job", "doc_job", "index", "req_job"),
    ).rejects.toMatchObject({
      code: "RAG_QUEUE_ENQUEUE_FAILED",
      status: 502,
    });
    expect(repositoryMock.setDocumentStatus).toHaveBeenLastCalledWith(
      "doc_job",
      "failed",
      expect.objectContaining({
        errorCode: "RAG_QUEUE_ENQUEUE_FAILED",
        errorRequestId: "req_job",
      }),
    );
  });

  it("runs inline without publishing when inline queue mode is selected", async () => {
    vi.stubEnv("BRANCHMIND_RAG_QUEUE_MODE", "inline");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { enqueueRagProcessingJob } = await import("@/lib/server/rag/jobs");

    const job = await enqueueRagProcessingJob(
      "user_job",
      "doc_job",
      "index",
      "req_job",
    );

    expect(job).toMatchObject({
      action: "index",
      documentId: "doc_job",
      messageId: null,
      topic: "rag-document-processing",
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(repositoryMock.setDocumentStatus).not.toHaveBeenLastCalledWith(
      "doc_job",
      "failed",
      expect.anything(),
    );
    await vi.waitFor(() => {
      expect(indexDocumentForOwnerMock).toHaveBeenCalledWith(
        "user_job",
        "doc_job",
        { requestId: "req_job" },
      );
    });
  });

  it("dispatches parse and index jobs to the existing indexer functions", async () => {
    const { processRagProcessingJob } = await import("@/lib/server/rag/jobs");

    await processRagProcessingJob({
      action: "parse",
      documentId: "doc_parse",
      requestId: "req_parse",
      userId: "user_parse",
    });
    await processRagProcessingJob({
      action: "index",
      documentId: "doc_index",
      requestId: "req_index",
      userId: "user_index",
    });

    expect(parseDocumentForOwnerMock).toHaveBeenCalledWith(
      "user_parse",
      "doc_parse",
      { requestId: "req_parse" },
    );
    expect(indexDocumentForOwnerMock).toHaveBeenCalledWith(
      "user_index",
      "doc_index",
      { requestId: "req_index" },
    );
  });

  it("acknowledges permanent failures and retries transient ones", async () => {
    const { getRagProcessingRetryDirective } = await import("@/lib/server/rag/jobs");

    expect(
      getRagProcessingRetryDirective(
        new RagError("Empty PDF", { status: 422 }),
        {
          consumerGroup: "rag",
          createdAt: new Date(),
          deliveryCount: 1,
          expiresAt: new Date(),
          messageId: "msg_1",
          region: "iad1",
          topicName: "rag-document-processing",
        },
      ),
    ).toEqual({ acknowledge: true });
    expect(
      getRagProcessingRetryDirective(new Error("temporary"), {
        consumerGroup: "rag",
        createdAt: new Date(),
        deliveryCount: 2,
        expiresAt: new Date(),
        messageId: "msg_2",
        region: "iad1",
        topicName: "rag-document-processing",
      }),
    ).toEqual({ afterSeconds: 40 });
    expect(
      getRagProcessingRetryDirective(new Error("poison"), {
        consumerGroup: "rag",
        createdAt: new Date(),
        deliveryCount: 5,
        expiresAt: new Date(),
        messageId: "msg_3",
        region: "iad1",
        topicName: "rag-document-processing",
      }),
    ).toEqual({ acknowledge: true });
  });

  it("exports a queue callback route handler", async () => {
    const callbackHandler = vi.fn(async () => new Response(null, { status: 204 }));
    handleCallbackMock.mockReturnValue(callbackHandler);
    vi.resetModules();
    const { POST } = await import("@/app/api/queues/rag-document-processing/route");

    const response = await POST(new Request("http://localhost/api/queues/rag"));

    expect(response.status).toBe(204);
    expect(callbackHandler).toHaveBeenCalled();
    expect(handleCallbackMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        visibilityTimeoutSeconds: 900,
      }),
    );
  });
});
