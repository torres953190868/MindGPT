import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "@/lib/server/rag/errors";
import type {
  ParsedDocument,
  RagDocument,
  RagPage,
  RagSection,
} from "@/lib/server/rag/types";

const mocks = vi.hoisted(() => ({
  getEmbeddingProvider: vi.fn(),
  parsePdf: vi.fn(),
  repository: {
    getPages: vi.fn(),
    getSections: vi.fn(),
    readDocumentFile: vi.fn(),
    replaceChunks: vi.fn(),
    saveParsedDocument: vi.fn(),
    setDocumentStatus: vi.fn(),
  },
}));

vi.mock("@/lib/server/rag/store", () => ({
  getRagRepository: () => mocks.repository,
  requireOwnedDocument: vi.fn(async () => document),
}));

vi.mock("@/lib/server/rag/parser", () => ({
  parsePdf: mocks.parsePdf,
}));

vi.mock("@/lib/server/rag/embeddings", () => ({
  getEmbeddingProvider: mocks.getEmbeddingProvider,
}));

const document: RagDocument = {
  id: "doc_diagnostics",
  userId: "user_diagnostics",
  fileName: "diagnostics.pdf",
  fileUrl: null,
  storagePath: "/tmp/diagnostics.pdf",
  mimeType: "application/pdf",
  pageCount: 1,
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

const page: RagPage = {
  id: "page_diagnostics",
  documentId: document.id,
  pageNumber: 1,
  rawText: "Chapter 1\n" + "alpha beta gamma delta ".repeat(120),
  cleanText: "Chapter 1\n" + "alpha beta gamma delta ".repeat(120),
  charCount: 0,
  tokenCount: 500,
  createdAt: document.createdAt,
};

const section: RagSection = {
  id: "section_diagnostics",
  documentId: document.id,
  title: "Chapter 1",
  headingPath: ["Chapter 1"],
  level: 1,
  pageStart: 1,
  pageEnd: 1,
  source: "regex",
  createdAt: document.createdAt,
};

const parsed: ParsedDocument = {
  pageCount: 1,
  title: null,
  pages: [{ pageNumber: 1, rawText: page.rawText, cleanText: page.cleanText }],
  sections: [
    {
      title: section.title,
      headingPath: section.headingPath,
      level: section.level,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      source: section.source,
    },
  ],
};

function failedStatusUpdate() {
  return mocks.repository.setDocumentStatus.mock.calls.find(
    ([, status]) => status === "failed",
  )?.[2];
}

describe("indexDocumentForOwner diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getEmbeddingProvider.mockReset();
    mocks.parsePdf.mockReset();
    Object.values(mocks.repository).forEach((mock) => mock.mockReset());

    mocks.repository.readDocumentFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.repository.saveParsedDocument.mockResolvedValue({
      document: { ...document, pageCount: 1, status: "parsed" },
      pages: [page],
      sections: [section],
    });
    mocks.repository.replaceChunks.mockImplementation(async (_documentId, chunks) => chunks);
    mocks.repository.setDocumentStatus.mockImplementation(
      async (_documentId, status, update = {}) => ({
        ...document,
        ...update,
        status,
      }),
    );
  });

  it("writes parsing diagnostics for text-empty PDFs", async () => {
    mocks.parsePdf.mockRejectedValue(
      new RagError("This MVP only supports text-based PDFs. OCR is not implemented yet.", {
        code: "PDF_TEXT_EMPTY",
        status: 422,
      }),
    );
    const { indexDocumentForOwner } = await import("@/lib/server/rag/indexer");

    await expect(
      indexDocumentForOwner("user_diagnostics", document.id, {
        requestId: "req_parse",
      }),
    ).rejects.toThrow("OCR is not implemented");

    expect(failedStatusUpdate()).toMatchObject({
      errorCode: "PDF_TEXT_EMPTY",
      errorRequestId: "req_parse",
      errorStage: "parsing",
    });
  });

  it("writes embedding provider diagnostics for final rate-limit failures", async () => {
    mocks.parsePdf.mockResolvedValue(parsed);
    mocks.getEmbeddingProvider.mockReturnValue({
      model: "gemini-embedding-2",
      embedTexts: vi.fn(async () => {
        throw new RagError("Resource exhausted. Please try again later.", {
          code: "GEMINI_EMBEDDING_FAILED",
          details: {
            model: "gemini-embedding-2",
            provider: "gemini",
            retryable: true,
            upstreamStatus: 429,
          },
          status: 429,
        });
      }),
    });
    const { indexDocumentForOwner } = await import("@/lib/server/rag/indexer");

    await expect(
      indexDocumentForOwner("user_diagnostics", document.id, {
        requestId: "req_embed",
      }),
    ).rejects.toThrow("Resource exhausted");

    expect(failedStatusUpdate()).toMatchObject({
      errorCode: "GEMINI_EMBEDDING_FAILED",
      errorMessage: "Embedding quota or rate limit was reached. Try again later or increase the provider quota.",
      errorRequestId: "req_embed",
      errorStage: "embedding",
      errorDetails: {
        model: "gemini-embedding-2",
        provider: "gemini",
        retryable: true,
        status: 429,
        upstreamStatus: 429,
      },
    });
  });

  it("clears diagnostics on successful indexing", async () => {
    mocks.parsePdf.mockResolvedValue(parsed);
    mocks.getEmbeddingProvider.mockReturnValue({
      model: "mock-embedding-v1",
      embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1])),
    });
    const { indexDocumentForOwner } = await import("@/lib/server/rag/indexer");

    await expect(
      indexDocumentForOwner("user_diagnostics", document.id, {
        requestId: "req_success",
      }),
    ).resolves.toMatchObject({
      document: { status: "indexed" },
      embeddingModel: "mock-embedding-v1",
    });

    const indexedUpdate = mocks.repository.setDocumentStatus.mock.calls.find(
      ([, status]) => status === "indexed",
    )?.[2];
    expect(indexedUpdate).toMatchObject({
      errorCode: null,
      errorDetails: null,
      errorMessage: null,
      errorRequestId: null,
      errorStage: null,
    });
  });
});
