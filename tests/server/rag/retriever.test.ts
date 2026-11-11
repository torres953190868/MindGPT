import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "@/lib/server/rag/embeddings";
import {
  computeRetrievalCandidateCount,
  cosineSimilarity,
  rankMatchedChunks,
  retrieveRelevantChunks,
} from "@/lib/server/rag/retriever";
import type { RagChunk, RagChunkMatch } from "@/lib/server/rag/types";

function makeChunk(
  id: string,
  content: string,
  overrides: Partial<RagChunk> = {},
): RagChunk {
  return {
    id,
    documentId: "doc_retriever",
    sectionId: null,
    parentChunkId: null,
    chunkIndex: 0,
    content,
    contentHash: `hash_${id}`,
    pageStart: 1,
    pageEnd: 1,
    headingPath: ["Chapter 1"],
    tokenCount: 16,
    charStart: 0,
    charEnd: content.length,
    embedding: null,
    embeddingModel: "mock",
    chunkVersion: "heading-recursive-v1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rag retriever", () => {
  it("computes retrieval candidate count with sensible minimums", () => {
    expect(computeRetrievalCandidateCount()).toBe(60);
    expect(computeRetrievalCandidateCount({ topK: 4, finalContextChunks: 2 })).toBe(24);
    expect(computeRetrievalCandidateCount({ topK: 24, finalContextChunks: 6 })).toBe(72);
    expect(computeRetrievalCandidateCount({ topK: 10, finalContextChunks: 10 })).toBe(40);
  });

  it("computes cosine similarity safely for null, empty, and valid vectors", () => {
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
    expect(cosineSimilarity([], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 5);
  });

  describe("rankMatchedChunks", () => {
    it("throws 409 DOCUMENT_HAS_NO_CHUNKS when matches are empty", () => {
      expect(() => rankMatchedChunks("Any question?", [])).toThrowError(
        expect.objectContaining({
          code: "DOCUMENT_HAS_NO_CHUNKS",
          status: 409,
        }),
      );
    });

    it("combines precomputed vector similarity with 0.15-weighted keyword score", () => {
      const matches: RagChunkMatch[] = [
        {
          chunk: makeChunk("vector_only", "completely unrelated background prose"),
          similarity: 0.8,
        },
        {
          chunk: makeChunk(
            "hybrid_winner",
            "hnsw pgvector index pushdown architecture",
          ),
          similarity: 0.72,
        },
      ];

      const ranked = rankMatchedChunks("hnsw pgvector pushdown", matches, {
        topK: 10,
        finalContextChunks: 2,
      });

      expect(ranked.map((item) => item.chunk.id)).toEqual([
        "hybrid_winner",
        "vector_only",
      ]);
      expect(ranked[0].vectorScore).toBeCloseTo(0.72, 5);
      expect(ranked[0].keywordScore).toBeCloseTo(1, 5);
      expect(ranked[0].score).toBeCloseTo(0.87, 5);
      expect(ranked[1].vectorScore).toBeCloseTo(0.8, 5);
      expect(ranked[1].keywordScore).toBe(0);
      expect(ranked[1].score).toBeCloseTo(0.8, 5);
    });

    it("enforces section diversity so one heading path does not crowd out all slots", () => {
      const matches: RagChunkMatch[] = [
        {
          chunk: makeChunk("ch1_1", "alpha", { headingPath: ["Chapter 1"] }),
          similarity: 0.95,
        },
        {
          chunk: makeChunk("ch1_2", "alpha", { headingPath: ["Chapter 1"] }),
          similarity: 0.94,
        },
        {
          chunk: makeChunk("ch1_3", "alpha", { headingPath: ["Chapter 1"] }),
          similarity: 0.93,
        },
        {
          chunk: makeChunk("ch1_4", "alpha", { headingPath: ["Chapter 1"] }),
          similarity: 0.92,
        },
        {
          chunk: makeChunk("ch2_1", "alpha", { headingPath: ["Chapter 2"] }),
          similarity: 0.75,
        },
      ];

      const selected = rankMatchedChunks("alpha", matches, {
        topK: 10,
        finalContextChunks: 5,
      });

      expect(selected.map((item) => item.chunk.id)).toEqual([
        "ch1_1",
        "ch1_2",
        "ch1_3",
        "ch2_1",
      ]);
    });
  });

  describe("retrieveRelevantChunks", () => {
    it("reuses a precomputed queryEmbedding without calling embedQuery again", async () => {
      const embedQueryMock = vi.fn(async () => [0, 1]);
      const provider: EmbeddingProvider = {
        model: "mock-provider",
        embedTexts: vi.fn(async () => []),
        embedQuery: embedQueryMock,
      };
      const chunks = [
        makeChunk("chunk_match", "pgvector retrieval", { embedding: [1, 0] }),
        makeChunk("chunk_other", "other topic", { embedding: [0, 1] }),
      ];

      const retrieved = await retrieveRelevantChunks(
        "pgvector retrieval",
        chunks,
        {
          embeddingProvider: provider,
          queryEmbedding: [1, 0],
          finalContextChunks: 1,
        },
      );

      expect(embedQueryMock).not.toHaveBeenCalled();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].chunk.id).toBe("chunk_match");
      expect(retrieved[0].vectorScore).toBeCloseTo(1, 5);
    });

    it("throws 409 DOCUMENT_HAS_NO_CHUNKS on empty chunks before calling embedQuery", async () => {
      const embedQueryMock = vi.fn(async () => [1, 0]);
      const provider: EmbeddingProvider = {
        model: "mock-provider",
        embedTexts: vi.fn(async () => []),
        embedQuery: embedQueryMock,
      };

      await expect(
        retrieveRelevantChunks("question", [], { embeddingProvider: provider }),
      ).rejects.toMatchObject({
        code: "DOCUMENT_HAS_NO_CHUNKS",
        status: 409,
      });
      expect(embedQueryMock).not.toHaveBeenCalled();
    });
  });
});
