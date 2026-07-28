import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";
import { RagError } from "@/lib/server/rag/errors";

const getBranchMindAuthContextMock = vi.hoisted(() => vi.fn());
const getDocumentFileSourceForOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: getBranchMindAuthContextMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  getDocumentFileSourceForOwner: getDocumentFileSourceForOwnerMock,
}));

const tempDirs: string[] = [];

function createFileRequest(headers?: HeadersInit, method = "GET") {
  return new NextRequest("http://localhost/api/documents/doc_route/file", {
    headers,
    method,
  });
}

function mockPdfFileSource(
  source: unknown,
  document: Record<string, unknown> = {},
) {
  getDocumentFileSourceForOwnerMock.mockResolvedValue({
    document: {
      fileName: "memory.pdf",
      mimeType: "application/pdf",
      ...document,
    },
    source,
  });
}

async function mockLocalPdfFile(
  bytes: Uint8Array,
  document: Record<string, unknown> = {},
) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "branchmind-file-route-"));
  tempDirs.push(tempDir);
  const filePath = path.join(tempDir, "document.pdf");
  await writeFile(filePath, bytes);
  mockPdfFileSource(
    { kind: "local", byteLength: bytes.byteLength, filePath },
    document,
  );
}

describe("document file route", () => {
  beforeEach(() => {
    getBranchMindAuthContextMock.mockReset();
    getBranchMindAuthContextMock.mockResolvedValue({
      principal: { id: "user_route", email: null, authMode: "local" },
      session: { id: "user_route", isNew: false },
    });
    getDocumentFileSourceForOwnerMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((tempDir) => rm(tempDir, { force: true, recursive: true })),
    );
  });

  it("streams owned local PDF bytes inline", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await mockLocalPdfFile(bytes);
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest(), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="memory.pdf"',
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=300, stale-while-revalidate=3600",
    );
    expect(response.headers.get("content-length")).toBe("4");
    expect(getDocumentFileSourceForOwnerMock).toHaveBeenCalledWith(
      "user_route",
      "doc_route",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves a byte range from a local PDF stream", async () => {
    await mockLocalPdfFile(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest({ Range: "bytes=1-2" }), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x44]),
    );
  });

  it("serves a suffix byte range for PDF streaming clients", async () => {
    await mockLocalPdfFile(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest({ Range: "bytes=-2" }), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-range")).toBe("bytes 2-3/4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x44, 0x46]),
    );
  });

  it("supports HEAD for local PDF metadata without a response body", async () => {
    await mockLocalPdfFile(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const { HEAD } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await HEAD(createFileRequest(undefined, "HEAD"), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("");
  });

  it("rejects an unsatisfiable byte range", async () => {
    await mockLocalPdfFile(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest({ Range: "bytes=99-120" }), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("0");
    expect(response.headers.get("content-range")).toBe("bytes */4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array());
  });

  it("redirects Supabase-backed PDFs to a signed Storage URL", async () => {
    mockPdfFileSource({
      kind: "redirect",
      signedUrl: "https://storage.example/signed.pdf?token=abc",
    });
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest(), {
      params: Promise.resolve({ documentId: "doc_supabase" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://storage.example/signed.pdf?token=abc",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=300, stale-while-revalidate=3600",
    );
  });

  it("serves non-ASCII PDF filenames with an ASCII-safe response header", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileSource(
      { kind: "bytes", bytes },
      {
        fileName: "英文原版-AI Engineering -- Chip Huyen -- 2024.pdf",
        mimeType: "application/pdf",
      },
    );
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest(), {
      params: Promise.resolve({ documentId: "doc_unicode" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename=\"-AI Engineering -- Chip Huyen -- 2024.pdf\"; filename*=UTF-8''%E8%8B%B1%E6%96%87%E5%8E%9F%E7%89%88-AI%20Engineering%20--%20Chip%20Huyen%20--%202024.pdf",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("returns the safe missing file error without exposing storage paths", async () => {
    getDocumentFileSourceForOwnerMock.mockRejectedValue(
      new RagError("PDF file was not found.", {
        code: "PDF_FILE_NOT_FOUND",
        status: 404,
      }),
    );
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest(), {
      params: Promise.resolve({ documentId: "doc_missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("PDF_FILE_NOT_FOUND");
    expect(body.error.message).toBe("PDF file was not found.");
    expect(JSON.stringify(body)).not.toContain("rag-files");
  });

  it("requires auth when Supabase auth rejects the request", async () => {
    getBranchMindAuthContextMock.mockRejectedValue(
      new HttpError("Sign in is required.", {
        code: "AUTH_REQUIRED",
        expose: true,
        status: 401,
      }),
    );
    const { GET } = await import("@/app/api/documents/[documentId]/file/route");

    const response = await GET(createFileRequest(), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(getDocumentFileSourceForOwnerMock).not.toHaveBeenCalled();
  });
});
