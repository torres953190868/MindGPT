import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDocumentDetailsForOwner,
  uploadPdfForOwner,
} from "@/lib/server/rag/service";

const repositoryMock = vi.hoisted(() => ({
  countChunks: vi.fn(),
  createUploadedDocument: vi.fn(),
  getDocument: vi.fn(),
  getChunks: vi.fn(),
  getSections: vi.fn(),
}));

vi.mock("@/lib/server/rag/store", () => ({
  getRagRepository: () => repositoryMock,
  requireOwnedDocument: async (userId: string, documentId: string) => {
    const document = await repositoryMock.getDocument(userId, documentId);
    if (!document) throw new Error("Document was not found.");
    return document;
  },
}));

describe("rag service", () => {
  beforeEach(() => {
    repositoryMock.countChunks.mockReset();
    repositoryMock.createUploadedDocument.mockReset();
    repositoryMock.getDocument.mockReset();
    repositoryMock.getChunks.mockReset();
    repositoryMock.getSections.mockReset();
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
});
