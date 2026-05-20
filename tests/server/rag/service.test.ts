import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocumentDetailsForOwner } from "@/lib/server/rag/service";

const repositoryMock = vi.hoisted(() => ({
  countChunks: vi.fn(),
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
});
