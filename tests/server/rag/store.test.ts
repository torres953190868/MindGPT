import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ParsedDocument,
  RagChunk,
  RagDocument,
} from "@/lib/server/rag/types";

const createIdMock = vi.hoisted(() => vi.fn());
const eqMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
const createSignedUrlMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const storageFromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ids", () => ({
  createId: createIdMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => ({
    from: fromMock,
    storage: {
      from: storageFromMock,
    },
  }),
  hasSupabaseServerConfig: () => true,
  requireSupabaseServerConfig: vi.fn(),
}));

const originalRagBackend = process.env.BRANCHMIND_RAG_BACKEND;
const legacyLocalFilePath = path.join(
  process.cwd(),
  "data",
  "rag-files",
  "doc_store_test_legacy_local.pdf",
);

async function removeLegacyLocalFile() {
  try {
    await unlink(legacyLocalFilePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function makeDocument(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "doc_storage",
    userId: "user_storage",
    fileName: "storage.pdf",
    fileUrl: null,
    storagePath: "users/user_storage/doc_storage.pdf",
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
    ...overrides,
  };
}

describe("rag store", () => {
  beforeEach(() => {
    process.env.BRANCHMIND_RAG_BACKEND = "supabase";
    createIdMock.mockReset();
    eqMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    fromMock.mockReset();
    uploadMock.mockReset();
    downloadMock.mockReset();
    createSignedUrlMock.mockReset();
    removeMock.mockReset();
    storageFromMock.mockReset();

    createIdMock.mockReturnValue("doc_storage");
    eqMock.mockResolvedValue({ count: 7, error: null });
    selectMock.mockReturnValue({ eq: eqMock });
    insertMock.mockImplementation((row) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: row, error: null })),
      })),
    }));
    updateMock.mockImplementation((row) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              ...makeDocument(),
              ...row,
              status: row.status ?? makeDocument().status,
            },
            error: null,
          })),
        })),
      })),
    }));
    deleteMock.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    fromMock.mockReturnValue({
      delete: deleteMock,
      insert: insertMock,
      select: selectMock,
      update: updateMock,
    });
    uploadMock.mockResolvedValue({ data: { path: "users/user_storage/doc_storage.pdf" }, error: null });
    downloadMock.mockResolvedValue({
      data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]),
      error: null,
    });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://storage.example/doc_storage.pdf?token=signed" },
      error: null,
    });
    removeMock.mockResolvedValue({ data: [], error: null });
    storageFromMock.mockReturnValue({
      createSignedUrl: createSignedUrlMock,
      download: downloadMock,
      remove: removeMock,
      upload: uploadMock,
    });
  });

  afterEach(async () => {
    if (originalRagBackend === undefined) {
      delete process.env.BRANCHMIND_RAG_BACKEND;
    } else {
      process.env.BRANCHMIND_RAG_BACKEND = originalRagBackend;
    }
    await removeLegacyLocalFile();
  });

  it("counts Supabase chunks without selecting embeddings", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const count = await getRagRepository().countChunks("doc_count");

    expect(count).toBe(7);
    expect(fromMock).toHaveBeenCalledWith("document_chunks");
    expect(selectMock).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
    expect(selectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("embedding"),
      expect.anything(),
    );
    expect(eqMock).toHaveBeenCalledWith("document_id", "doc_count");
  });

  it("stores Supabase PDF bytes in Storage and keeps only an object key in metadata", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const document = await getRagRepository().createUploadedDocument({
      userId: "user_storage",
      fileName: "storage.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      contentHash: "a".repeat(64),
    });

    expect(storageFromMock).toHaveBeenCalledWith("branchmind-rag-files");
    expect(uploadMock).toHaveBeenCalledWith(
      "users/user_storage/doc_storage.pdf",
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      { contentType: "application/pdf", upsert: false },
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc_storage",
        storage_path: "users/user_storage/doc_storage.pdf",
        content_hash: "a".repeat(64),
      }),
    );
    expect(document.storagePath).toBe("users/user_storage/doc_storage.pdf");
    expect(document.storagePath).not.toContain("rag-files");
  });

  it("reads Supabase PDF bytes back from Storage", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const bytes = await getRagRepository().readDocumentFile(makeDocument());

    expect(storageFromMock).toHaveBeenCalledWith("branchmind-rag-files");
    expect(downloadMock).toHaveBeenCalledWith("users/user_storage/doc_storage.pdf");
    expect(bytes).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("returns a signed URL source for Supabase PDF streaming", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const source = await getRagRepository().getDocumentFileSource(makeDocument());

    expect(storageFromMock).toHaveBeenCalledWith("branchmind-rag-files");
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      "users/user_storage/doc_storage.pdf",
      300,
    );
    expect(source).toEqual({
      kind: "redirect",
      signedUrl: "https://storage.example/doc_storage.pdf?token=signed",
    });
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("reads legacy local PDF bytes for migrated Supabase metadata", async () => {
    const legacyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await mkdir(path.dirname(legacyLocalFilePath), { recursive: true });
    await writeFile(legacyLocalFilePath, legacyBytes);
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const bytesFromMigratedPath = await getRagRepository().readDocumentFile(
      makeDocument({
        id: "doc_store_test_legacy_local",
        storagePath: legacyLocalFilePath,
      }),
    );
    const bytesFromLegacyId = await getRagRepository().readDocumentFile(
      makeDocument({
        id: "doc_store_test_legacy_local",
        storagePath: "users/user_storage/doc_store_test_legacy_local.pdf",
      }),
    );

    expect(downloadMock).not.toHaveBeenCalled();
    expect(bytesFromMigratedPath).toEqual(legacyBytes);
    expect(bytesFromLegacyId).toEqual(legacyBytes);
  });

  it("returns a local file source for migrated Supabase metadata", async () => {
    const legacyBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await mkdir(path.dirname(legacyLocalFilePath), { recursive: true });
    await writeFile(legacyLocalFilePath, legacyBytes);
    const { getRagRepository } = await import("@/lib/server/rag/store");

    const source = await getRagRepository().getDocumentFileSource(
      makeDocument({
        id: "doc_store_test_legacy_local",
        storagePath: "users/user_storage/doc_store_test_legacy_local.pdf",
      }),
    );

    expect(source).toMatchObject({
      kind: "local",
      byteLength: legacyBytes.byteLength,
      filePath: legacyLocalFilePath,
    });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("deletes Supabase document metadata and its Storage object", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    await getRagRepository().deleteDocument(makeDocument());

    expect(fromMock).toHaveBeenCalledWith("documents");
    expect(deleteMock).toHaveBeenCalled();
    expect(storageFromMock).toHaveBeenCalledWith("branchmind-rag-files");
    expect(removeMock).toHaveBeenCalledWith(["users/user_storage/doc_storage.pdf"]);
  });

  it("returns null when a Supabase document has no Storage object key", async () => {
    const { getRagRepository } = await import("@/lib/server/rag/store");

    await expect(
      getRagRepository().readDocumentFile(makeDocument({ storagePath: null })),
    ).resolves.toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("classifies a stale queued-status constraint as a schema migration error", async () => {
    updateMock.mockReturnValueOnce({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: null,
            error: {
              code: "23514",
              details:
                "Failing row contains (doc_storage, user_storage, storage.pdf, null, null, application/pdf, 0, null, queued, ...).",
              message:
                'new row for relation "documents" violates check constraint "documents_status_check"',
            },
          })),
        })),
      })),
    });
    const { getRagRepository } = await import("@/lib/server/rag/store");

    await expect(
      getRagRepository().setDocumentStatus("doc_storage", "queued"),
    ).rejects.toMatchObject({
      code: "RAG_SUPABASE_SCHEMA_ERROR",
      message: expect.stringContaining("20260524000000_pdf_rag_queued_status.sql"),
    });
  });

  it("persists parsed Supabase rows in batches for large PDFs", async () => {
    createIdMock.mockImplementation(
      (prefix: string) => `${prefix}_${createIdMock.mock.calls.length}`,
    );
    const parsed: ParsedDocument = {
      pageCount: 56,
      title: "Large PDF",
      pages: Array.from({ length: 56 }, (_, index) => ({
        pageNumber: index + 1,
        rawText: `Page ${index + 1}\n${"alpha beta ".repeat(120)}`,
        cleanText: `Page ${index + 1}\n${"alpha beta ".repeat(120)}`,
      })),
      sections: Array.from({ length: 31 }, (_, index) => ({
        title: `Section ${index + 1}`,
        headingPath: [`Section ${index + 1}`],
        level: 1,
        pageStart: index + 1,
        pageEnd: index + 1,
        source: "regex",
      })),
    };
    const { getRagRepository } = await import("@/lib/server/rag/store");

    await getRagRepository().saveParsedDocument(makeDocument(), parsed);

    const batchedInserts = insertMock.mock.calls
      .map(([rows]) => rows)
      .filter(Array.isArray);
    expect(batchedInserts.map((rows) => rows.length)).toEqual([
      25,
      25,
      6,
      25,
      6,
    ]);
  });

  it("persists Supabase chunk embeddings in batches for large PDFs", async () => {
    const chunks: RagChunk[] = Array.from({ length: 61 }, (_, index) => ({
      id: `chunk_${index + 1}`,
      documentId: "doc_storage",
      sectionId: null,
      parentChunkId: null,
      chunkIndex: index,
      content: `Chunk ${index + 1} ${"alpha beta ".repeat(80)}`,
      contentHash: `hash_${index + 1}`,
      pageStart: index + 1,
      pageEnd: index + 1,
      headingPath: [],
      tokenCount: 200,
      charStart: 0,
      charEnd: 100,
      embedding: Array.from({ length: 1024 }, () => 0.01),
      embeddingModel: "gemini-embedding-2",
      chunkVersion: "heading-recursive-v1",
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const { getRagRepository } = await import("@/lib/server/rag/store");

    await getRagRepository().replaceChunks("doc_storage", chunks);

    const batchedInserts = insertMock.mock.calls
      .map(([rows]) => rows)
      .filter(Array.isArray);
    expect(batchedInserts.map((rows) => rows.length)).toEqual([25, 25, 11]);
  });
});
