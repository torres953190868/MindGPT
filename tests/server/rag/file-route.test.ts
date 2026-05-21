import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";
import { RagError } from "@/lib/server/rag/errors";
import { getDocumentFileForOwner } from "@/lib/server/rag/service";

const getBranchMindAuthContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: getBranchMindAuthContextMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  getDocumentFileForOwner: vi.fn(),
}));

type FileInfo = Awaited<ReturnType<typeof getDocumentFileForOwner>>;

function createFileRequest(headers?: HeadersInit) {
  return new NextRequest("http://localhost/api/documents/doc_route/file", {
    headers,
  });
}

function mockPdfFileInfo(
  bytes: Uint8Array,
  document: Partial<FileInfo["document"]> = {},
) {
  vi.mocked(getDocumentFileForOwner).mockResolvedValue({
    document: {
      fileName: "memory.pdf",
      mimeType: "application/pdf",
      ...document,
    } as FileInfo["document"],
    bytes,
  });
}

describe("document file route", () => {
  beforeEach(() => {
    getBranchMindAuthContextMock.mockReset();
    getBranchMindAuthContextMock.mockResolvedValue({
      principal: { id: "user_route", email: null, authMode: "local" },
      session: { id: "user_route", isNew: false },
    });
    vi.mocked(getDocumentFileForOwner).mockReset();
  });

  it("serves owned PDF bytes inline", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileInfo(bytes);
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
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("content-length")).toBe("4");
    expect(getDocumentFileForOwner).toHaveBeenCalledWith(
      "user_route",
      "doc_route",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves a byte range for PDF streaming clients", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileInfo(bytes);
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
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileInfo(bytes);
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

  it("rejects an unsatisfiable byte range", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileInfo(bytes);
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

  it("serves non-ASCII PDF filenames with an ASCII-safe response header", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockPdfFileInfo(bytes, {
      fileName: "英文原版-AI Engineering -- Chip Huyen -- 2024.pdf",
      mimeType: "application/pdf",
    });
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
    vi.mocked(getDocumentFileForOwner).mockRejectedValue(
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
    expect(getDocumentFileForOwner).not.toHaveBeenCalled();
  });
});
