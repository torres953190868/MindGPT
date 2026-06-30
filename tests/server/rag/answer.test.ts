import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";
import { generateGroundedAnswer } from "@/lib/server/rag/answer";
import type { RagChunk, RagSection } from "@/lib/server/rag/types";

const resolveLlmCandidatesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/llm-router", () => ({
  getLlmRequestTimeoutMs: vi.fn(() => 30_000),
  requireLlmProviderApiKey: vi.fn(() => "test-key"),
  resolveLlmCandidates: resolveLlmCandidatesMock,
}));

function makeChunk(id: string, content: string): RagChunk {
  return {
    id,
    documentId: "doc_test",
    sectionId: null,
    parentChunkId: null,
    chunkIndex: 0,
    content,
    contentHash: "hash",
    pageStart: 1,
    pageEnd: 1,
    headingPath: [],
    tokenCount: 10,
    charStart: null,
    charEnd: null,
    embedding: null,
    embeddingModel: null,
    chunkVersion: "v1",
    metadata: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("RAG answer plan restriction", () => {
  beforeEach(() => {
    resolveLlmCandidatesMock.mockReset();
  });

  it("preserves PLAN_MODEL_NOT_ALLOWED from candidate resolution as a RagError", async () => {
    resolveLlmCandidatesMock.mockRejectedValue(
      new HttpError("No AI model for this task is available on the free plan.", {
        code: "PLAN_MODEL_NOT_ALLOWED",
        expose: true,
        status: 403,
      }),
    );

    const retrieved = [
      {
        chunk: makeChunk("chunk_1", "Memory retrieval context."),
        score: 0.9,
        vectorScore: 0.9,
        keywordScore: 0.3,
      },
    ];

    await expect(
      generateGroundedAnswer("What is memory?", retrieved, [] as RagSection[], {
        userPlan: "free",
      }),
    ).rejects.toMatchObject({
      message: "No AI model for this task is available on the free plan.",
      code: "PLAN_MODEL_NOT_ALLOWED",
      status: 403,
      expose: true,
    });
  });

  it("still retries provider request failures for unrestricted plans", async () => {
    resolveLlmCandidatesMock.mockResolvedValue([
      {
        provider: {
          providerId: "deepseek",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com/chat/completions",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          enabled: true,
          timeoutMs: null,
          payloadOptions: {},
          errorCodePrefix: "DEEPSEEK",
        },
        model: {
          providerId: "deepseek",
          model: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          enabled: true,
          supportsStreaming: true,
          supportsJson: true,
          notes: null,
          sortOrder: 10,
        },
        source: "default",
        task: "pdf_qa",
      },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "Server error" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    const retrieved = [
      {
        chunk: makeChunk("chunk_1", "Memory retrieval context."),
        score: 0.9,
        vectorScore: 0.9,
        keywordScore: 0.3,
      },
    ];

    await expect(
      generateGroundedAnswer("What is memory?", retrieved, [] as RagSection[], {
        userPlan: "pro",
      }),
    ).rejects.toMatchObject({
      code: "LLM_REQUEST_FAILED",
      status: 503,
    });

    vi.unstubAllGlobals();
  });
});
