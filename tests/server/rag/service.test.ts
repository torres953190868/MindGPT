import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbeddingProvider } from "@/lib/server/rag/embeddings";
import { RagError } from "@/lib/server/rag/errors";
import {
  getDocumentDetailsForOwner,
  getWorkspaceDocumentContextsForOwner,
  queryDocumentForOwner,
  uploadPdfForOwner,
} from "@/lib/server/rag/service";
import type {
  RagChunk,
  RagChunkMatch,
  RagDocument,
  RagSection,
} from "@/lib/server/rag/types";
import type { ChatAttachment } from "@/lib/types";

type MatchChunksFn = (
  documentId: string,
  queryEmbedding: number[],
  matchCount?: number,
) => Promise<RagChunkMatch[]>;

const repositoryMock = vi.hoisted(() => ({
  countChunks: vi.fn(),
  createUploadedDocument: vi.fn(),
  getDocument: vi.fn(),
  getChunks: vi.fn(),
  getSections: vi.fn(),
  matchChunks: undefined as ReturnType<typeof vi.fn<MatchChunksFn>> | undefined,
}));

vi.mock("@/lib/server/rag/store", () => ({
  getRagRepository: () => repositoryMock,
  requireOwnedDocument: async (userId: string, documentId: string) => {
    const document = await repositoryMock.getDocument(userId, documentId);
    if (!document) {
      throw new RagError("Document was not found.", {
        code: "DOCUMENT_NOT_FOUND",
        status: 404,
      });
    }
    return document;
  },
}));

function makeAttachment(documentId: string, name = `${documentId}.pdf`): ChatAttachment {
  return {
    id: `att_${documentId}`,
    name,
    mimeType: "application/pdf",
    size: 1024,
    createdAt: "2026-01-01T00:00:00.000Z",
    documentId,
    documentStatus: "indexed",
  };
}

function makeRagDocument(
  id: string,
  overrides: Partial<RagDocument> = {},
): RagDocument {
  return {
    id,
    userId: "user_1",
    fileName: `${id}.pdf`,
    fileUrl: null,
    storagePath: null,
    mimeType: "application/pdf",
    contentHash: null,
    pageCount: 10,
    title: `Title ${id}`,
    status: "indexed",
    parserVersion: "1",
    chunkVersion: "1",
    errorMessage: null,
    errorCode: null,
    errorStage: null,
    errorRequestId: null,
    errorDetails: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRagChunk(
  documentId: string,
  index = 0,
  content = `Content about retrieval architecture for ${documentId}`,
): RagChunk {
  return {
    id: `${documentId}_chunk_${index}`,
    documentId,
    sectionId: null,
    parentChunkId: null,
    chunkIndex: index,
    content,
    contentHash: `hash_${documentId}_${index}`,
    pageStart: index + 1,
    pageEnd: index + 1,
    headingPath: ["Chapter 1"],
    tokenCount: 12,
    charStart: 0,
    charEnd: content.length,
    embedding: null,
    embeddingModel: "mock",
    chunkVersion: "1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRagSection(
  documentId: string,
  overrides: Partial<RagSection> & Pick<RagSection, "title" | "pageStart" | "pageEnd">,
): RagSection {
  return {
    id: overrides.id ?? `${documentId}_sec_${overrides.pageStart}`,
    documentId,
    title: overrides.title,
    headingPath: overrides.headingPath ?? [overrides.title],
    level: overrides.level ?? 1,
    pageStart: overrides.pageStart,
    pageEnd: overrides.pageEnd,
    source: overrides.source ?? "pdf_outline",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("rag service", () => {
  beforeEach(() => {
    vi.stubEnv("AI_MOCK_MODE", "true");
    repositoryMock.countChunks.mockReset();
    repositoryMock.createUploadedDocument.mockReset();
    repositoryMock.getDocument.mockReset();
    repositoryMock.getChunks.mockReset();
    repositoryMock.getSections.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads document details without reading full chunks", async () => {
    repositoryMock.getDocument.mockResolvedValue({
      id: "doc_details",
      fileName: "details.pdf",
      pageCount: 12,
      status: "parsed",
    });
    repositoryMock.getSections.mockResolvedValue([
      { id: "section_1", title: "Intro", pageStart: 1, pageEnd: 2 },
    ]);
    repositoryMock.countChunks.mockResolvedValue(42);

    const details = await getDocumentDetailsForOwner("user_details", "doc_details");

    expect(details.chunkCount).toBe(42);
    expect(details.sections).toHaveLength(1);
    expect(repositoryMock.getDocument).toHaveBeenCalledWith(
      "user_details",
      "doc_details",
    );
    expect(repositoryMock.getSections).toHaveBeenCalledWith("doc_details");
    expect(repositoryMock.countChunks).toHaveBeenCalledWith("doc_details");
    expect(repositoryMock.getChunks).not.toHaveBeenCalled();
  });

  it("computes a stable content hash before storing an upload", async () => {
    repositoryMock.createUploadedDocument.mockImplementation(async (upload) => ({
      id: "doc_hashed",
      ...upload,
      pageCount: 0,
      title: null,
      status: "uploaded",
    }));
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const document = await uploadPdfForOwner("user_hash", {
      name: "paper.pdf",
      type: "application/pdf",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    });

    expect(repositoryMock.createUploadedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_hash",
        fileName: "paper.pdf",
        contentHash: "315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027",
      }),
    );
    expect(document.contentHash).toHaveLength(64);
  });

  describe("getWorkspaceDocumentContextsForOwner", () => {
    it("injects formatted global document outline alongside retrieved snippets and omits empty outlines", async () => {
      repositoryMock.getDocument.mockImplementation(async (_userId, docId) => {
        if (docId === "doc_with_outline") return makeRagDocument("doc_with_outline");
        if (docId === "doc_no_outline") return makeRagDocument("doc_no_outline");
        return null;
      });
      repositoryMock.getSections.mockImplementation(async (docId) => {
        if (docId === "doc_with_outline") {
          return [
            makeRagSection("doc_with_outline", {
              title: "Methods",
              level: 2,
              pageStart: 3,
              pageEnd: 6,
            }),
            makeRagSection("doc_with_outline", {
              title: "Introduction",
              level: 1,
              pageStart: 1,
              pageEnd: 2,
            }),
          ];
        }
        return [];
      });
      repositoryMock.getChunks.mockImplementation(async (docId) => [
        makeRagChunk(docId, 0),
      ]);

      const contexts = await getWorkspaceDocumentContextsForOwner(
        "user_1",
        [makeAttachment("doc_with_outline"), makeAttachment("doc_no_outline")],
        "What are the methods?",
      );

      expect(contexts).toHaveLength(2);
      expect(contexts[0].documentId).toBe("doc_with_outline");
      expect(contexts[0].outline).toBe(
        "- Introduction (pp. 1-2)\n  - Methods (pp. 3-6)",
      );
      expect(contexts[0].snippets).toHaveLength(1);

      expect(contexts[1].documentId).toBe("doc_no_outline");
      expect("outline" in contexts[1]).toBe(false);
      expect(contexts[1].snippets).toHaveLength(1);
    });

    it("throws 409 ATTACHED_DOCUMENT_NOT_INDEXED for explicit unindexed PDFs", async () => {
      repositoryMock.getDocument.mockResolvedValue(
        makeRagDocument("doc_parsing", {
          fileName: "draft.pdf",
          status: "indexing",
        }),
      );

      await expect(
        getWorkspaceDocumentContextsForOwner(
          "user_1",
          [makeAttachment("doc_parsing")],
          "Summarize",
        ),
      ).rejects.toMatchObject({
        code: "ATTACHED_DOCUMENT_NOT_INDEXED",
        status: 409,
      });
    });

    it("preserves 404 and 409 DOCUMENT_HAS_NO_CHUNKS errors for explicit PDFs", async () => {
      repositoryMock.getDocument.mockResolvedValueOnce(null);

      await expect(
        getWorkspaceDocumentContextsForOwner(
          "user_1",
          [makeAttachment("doc_missing")],
          "Summarize",
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_NOT_FOUND",
        status: 404,
      });

      repositoryMock.getDocument.mockResolvedValueOnce(makeRagDocument("doc_empty"));
      repositoryMock.getSections.mockResolvedValueOnce([]);
      repositoryMock.getChunks.mockResolvedValueOnce([]);

      await expect(
        getWorkspaceDocumentContextsForOwner(
          "user_1",
          [makeAttachment("doc_empty")],
          "Summarize",
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_HAS_NO_CHUNKS",
        status: 409,
      });
    });

    it("resolves valid inherited attachments behind explicit attachments, deduplicating and silently skipping deleted, unindexed, or empty-chunk inherited PDFs without wasting slots", async () => {
      const docs: Record<string, RagDocument> = {
        doc_explicit: makeRagDocument("doc_explicit"),
        doc_inherited_unindexed: makeRagDocument("doc_inherited_unindexed", {
          status: "parsing",
        }),
        doc_inherited_empty: makeRagDocument("doc_inherited_empty"),
        doc_inherited_valid_1: makeRagDocument("doc_inherited_valid_1"),
        doc_inherited_valid_2: makeRagDocument("doc_inherited_valid_2"),
        doc_inherited_overflow: makeRagDocument("doc_inherited_overflow"),
      };

      repositoryMock.getDocument.mockImplementation(
        async (_userId: string, docId: string) => docs[docId] ?? null,
      );
      repositoryMock.getSections.mockImplementation(async (docId: string) => [
        makeRagSection(docId, {
          title: `Overview of ${docId}`,
          level: 1,
          pageStart: 1,
          pageEnd: 4,
        }),
      ]);
      repositoryMock.getChunks.mockImplementation(async (docId: string) => {
        if (docId === "doc_inherited_empty") return [];
        return [makeRagChunk(docId, 0)];
      });

      const contexts = await getWorkspaceDocumentContextsForOwner(
        "user_1",
        [makeAttachment("doc_explicit")],
        "Compare retrieval designs",
        {
          inheritedAttachments: [
            makeAttachment("doc_explicit"), // duplicate of explicit -> ignored
            makeAttachment("doc_inherited_deleted"), // missing -> skipped without 404 or slot loss
            makeAttachment("doc_inherited_unindexed"), // unindexed -> skipped without 409 or slot loss
            makeAttachment("doc_inherited_empty"), // 0 chunks -> skipped without 409 or slot loss
            makeAttachment("doc_inherited_valid_1"), // fills slot 2
            makeAttachment("doc_inherited_valid_2"), // fills slot 3
            makeAttachment("doc_inherited_overflow"), // beyond MAX_WORKSPACE_CONTEXT_DOCUMENTS (3)
          ],
        },
      );

      expect(contexts.map((ctx) => ctx.documentId)).toEqual([
        "doc_explicit",
        "doc_inherited_valid_1",
        "doc_inherited_valid_2",
      ]);
      expect(contexts[0].outline).toBe("- Overview of doc_explicit (pp. 1-4)");
      expect(contexts[1].outline).toBe("- Overview of doc_inherited_valid_1 (pp. 1-4)");
      expect(contexts[2].outline).toBe("- Overview of doc_inherited_valid_2 (pp. 1-4)");
      expect(repositoryMock.getDocument).not.toHaveBeenCalledWith(
        "user_1",
        "doc_inherited_overflow",
      );
    });

    it("returns an empty array when all inherited attachments are stale and no explicit attachments exist", async () => {
      repositoryMock.getDocument.mockResolvedValue(null);

      const contexts = await getWorkspaceDocumentContextsForOwner(
        "user_1",
        [],
        "Any question",
        {
          inheritedAttachments: [makeAttachment("doc_deleted")],
        },
      );

      expect(contexts).toEqual([]);
    });
  });

  describe("pgvector matchChunks pushdown and single-embed retrieval", () => {
    let matchChunksMock: ReturnType<typeof vi.fn<MatchChunksFn>>;

    beforeEach(() => {
      matchChunksMock = vi.fn<MatchChunksFn>();
      repositoryMock.matchChunks = matchChunksMock;
    });

    afterEach(() => {
      repositoryMock.matchChunks = undefined;
      vi.restoreAllMocks();
    });

    it("uses matchChunks in queryDocumentForOwner without calling getChunks", async () => {
      const embedQuerySpy = vi.spyOn(
        MockEmbeddingProvider.prototype,
        "embedQuery",
      );
      repositoryMock.getDocument.mockResolvedValue(makeRagDocument("doc_query"));
      repositoryMock.getSections.mockResolvedValue([
        makeRagSection("doc_query", {
          title: "Chapter 1",
          pageStart: 1,
          pageEnd: 3,
        }),
      ]);
      matchChunksMock.mockResolvedValue([
        {
          chunk: makeRagChunk(
            "doc_query",
            0,
            "Vector pushdown reduces memory transfer.",
          ),
          similarity: 0.91,
        } satisfies RagChunkMatch,
      ]);

      const response = await queryDocumentForOwner(
        "user_1",
        "doc_query",
        "How does vector pushdown work?",
        10,
      );

      expect(embedQuerySpy).toHaveBeenCalledTimes(1);
      expect(embedQuerySpy).toHaveBeenCalledWith("How does vector pushdown work?");
      expect(matchChunksMock).toHaveBeenCalledTimes(1);
      expect(matchChunksMock).toHaveBeenCalledWith(
        "doc_query",
        expect.any(Array),
        30,
      );
      expect(repositoryMock.getChunks).not.toHaveBeenCalled();
      expect(response.citations).toHaveLength(1);
      expect(response.citations[0].chunkId).toBe("doc_query_chunk_0");
    });

    it("embeds the workspace question only ONCE across 3 attached PDFs and uses matchChunks without getChunks", async () => {
      const embedQuerySpy = vi.spyOn(
        MockEmbeddingProvider.prototype,
        "embedQuery",
      );
      repositoryMock.getDocument.mockImplementation(
        async (_userId: string, docId: string) => makeRagDocument(docId),
      );
      repositoryMock.getSections.mockImplementation(async (docId: string) => [
        makeRagSection(docId, {
          title: `Section for ${docId}`,
          pageStart: 1,
          pageEnd: 2,
        }),
      ]);
      matchChunksMock.mockImplementation(
        async (docId: string): Promise<RagChunkMatch[]> => [
          {
            chunk: makeRagChunk(
              docId,
              0,
              `Key architecture evidence in ${docId}`,
            ),
            similarity: 0.88,
          },
          {
            chunk: makeRagChunk(
              docId,
              1,
              `Secondary findings in ${docId}`,
            ),
            similarity: 0.74,
          },
        ],
      );

      const contexts = await getWorkspaceDocumentContextsForOwner(
        "user_1",
        [
          makeAttachment("doc_1"),
          makeAttachment("doc_2"),
          makeAttachment("doc_3"),
        ],
        "Compare the architecture across all three PDFs",
      );

      expect(embedQuerySpy).toHaveBeenCalledTimes(1);
      expect(embedQuerySpy).toHaveBeenCalledWith(
        "Compare the architecture across all three PDFs",
      );
      expect(matchChunksMock).toHaveBeenCalledTimes(3);
      const firstQueryEmbedding = matchChunksMock.mock.calls[0][1];
      expect(matchChunksMock.mock.calls[1][1]).toBe(firstQueryEmbedding);
      expect(matchChunksMock.mock.calls[2][1]).toBe(firstQueryEmbedding);
      expect(repositoryMock.getChunks).not.toHaveBeenCalled();
      expect(contexts.map((ctx) => ctx.documentId)).toEqual([
        "doc_1",
        "doc_2",
        "doc_3",
      ]);
      expect(contexts.every((ctx) => ctx.snippets.length === 2)).toBe(true);
    });

    it("throws 409 DOCUMENT_HAS_NO_CHUNKS on empty explicit doc and fails fast before embedQuery on unindexed explicit or all-stale inherited docs", async () => {
      const embedQuerySpy = vi.spyOn(
        MockEmbeddingProvider.prototype,
        "embedQuery",
      );

      repositoryMock.getDocument.mockResolvedValueOnce(
        makeRagDocument("doc_unindexed", { status: "parsing" }),
      );
      await expect(
        getWorkspaceDocumentContextsForOwner(
          "user_1",
          [makeAttachment("doc_unindexed")],
          "Summarize",
        ),
      ).rejects.toMatchObject({
        code: "ATTACHED_DOCUMENT_NOT_INDEXED",
        status: 409,
      });
      expect(embedQuerySpy).not.toHaveBeenCalled();

      repositoryMock.getDocument.mockResolvedValueOnce(null);
      await expect(
        getWorkspaceDocumentContextsForOwner("user_1", [], "Summarize", {
          inheritedAttachments: [makeAttachment("doc_deleted")],
        }),
      ).resolves.toEqual([]);
      expect(embedQuerySpy).not.toHaveBeenCalled();

      repositoryMock.getDocument.mockResolvedValueOnce(
        makeRagDocument("doc_empty_explicit"),
      );
      repositoryMock.getSections.mockResolvedValueOnce([]);
      matchChunksMock.mockResolvedValueOnce([]);

      await expect(
        getWorkspaceDocumentContextsForOwner(
          "user_1",
          [makeAttachment("doc_empty_explicit")],
          "Summarize",
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_HAS_NO_CHUNKS",
        status: 409,
      });
      expect(embedQuerySpy).toHaveBeenCalledTimes(1);
    });

    it("skips empty inherited docs without consuming a slot while reusing the single queryEmbedding", async () => {
      const embedQuerySpy = vi.spyOn(
        MockEmbeddingProvider.prototype,
        "embedQuery",
      );
      const docs: Record<string, RagDocument> = {
        doc_explicit: makeRagDocument("doc_explicit"),
        doc_inherited_empty: makeRagDocument("doc_inherited_empty"),
        doc_inherited_1: makeRagDocument("doc_inherited_1"),
        doc_inherited_2: makeRagDocument("doc_inherited_2"),
        doc_inherited_overflow: makeRagDocument("doc_inherited_overflow"),
      };

      repositoryMock.getDocument.mockImplementation(
        async (_userId: string, docId: string) => docs[docId] ?? null,
      );
      repositoryMock.getSections.mockResolvedValue([]);
      matchChunksMock.mockImplementation(
        async (docId: string): Promise<RagChunkMatch[]> => {
          if (docId === "doc_inherited_empty") return [];
          return [
            {
              chunk: makeRagChunk(docId, 0),
              similarity: 0.85,
            },
          ];
        },
      );

      const contexts = await getWorkspaceDocumentContextsForOwner(
        "user_1",
        [makeAttachment("doc_explicit")],
        "Question across explicit and inherited docs",
        {
          inheritedAttachments: [
            makeAttachment("doc_inherited_empty"),
            makeAttachment("doc_inherited_1"),
            makeAttachment("doc_inherited_2"),
            makeAttachment("doc_inherited_overflow"),
          ],
        },
      );

      expect(embedQuerySpy).toHaveBeenCalledTimes(1);
      expect(repositoryMock.getChunks).not.toHaveBeenCalled();
      expect(contexts.map((ctx) => ctx.documentId)).toEqual([
        "doc_explicit",
        "doc_inherited_1",
        "doc_inherited_2",
      ]);
      expect(repositoryMock.getDocument).not.toHaveBeenCalledWith(
        "user_1",
        "doc_inherited_overflow",
      );
    });
  });
});
