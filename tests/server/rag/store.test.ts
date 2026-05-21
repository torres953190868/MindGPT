import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RagDocument } from "@/lib/server/rag/types";

const createIdMock = vi.hoisted(() => vi.fn());
const eqMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
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
    deleteMock.mockReset();
    fromMock.mockReset();
    uploadMock.mockReset();
    downloadMock.mockReset();
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
    deleteMock.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    fromMock.mockReturnValue({
      delete: deleteMock,
      insert: insertMock,
      select: selectMock,
    });
    uploadMock.mockResolvedValue({ data: { path: "users/user_storage/doc_storage.pdf" }, error: null });
    downloadMock.mockResolvedValue({
      data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]),
      error: null,
    });
    removeMock.mockResolvedValue({ data: [], error: null });
    storageFromMock.mockReturnValue({
      download: downloadMock,
      remove: removeMock,
      upload: uploadMock,
    });
  });

  afterEach(() => {
    if (originalRagBackend === undefined) {
      delete process.env.BRANCHMIND_RAG_BACKEND;
    } else {
      process.env.BRANCHMIND_RAG_BACKEND = originalRagBackend;
    }
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
});
