import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renameDocumentForOwnerMock = vi.hoisted(() => vi.fn());
const deleteDocumentForOwnerMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "owner_doc", email: null, authMode: "local" },
    session: { id: "owner_doc", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  deleteDocumentForOwner: deleteDocumentForOwnerMock,
  getDocumentDetailsForOwner: vi.fn(),
  renameDocumentForOwner: renameDocumentForOwnerMock,
}));

function documentRequest(method: "PATCH" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/documents/doc_route", {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Origin: "http://localhost",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("document route", () => {
  beforeEach(() => {
    renameDocumentForOwnerMock.mockReset();
    deleteDocumentForOwnerMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("renames a document with trimmed input", async () => {
    renameDocumentForOwnerMock.mockResolvedValue({
      id: "doc_route",
      fileName: "Renamed report.pdf",
      title: "Renamed report",
    });
    const { PATCH } = await import("@/app/api/documents/[documentId]/route");

    const response = await PATCH(
      documentRequest("PATCH", { name: "  Renamed report  " }),
      { params: Promise.resolve({ documentId: "doc_route" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.document.title).toBe("Renamed report");
    expect(renameDocumentForOwnerMock).toHaveBeenCalledWith(
      "owner_doc",
      "doc_route",
      "Renamed report",
    );
  });

  it("rejects blank document names", async () => {
    const { PATCH } = await import("@/app/api/documents/[documentId]/route");

    const response = await PATCH(documentRequest("PATCH", { name: "   " }), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });

    expect(response.status).toBe(400);
    expect(renameDocumentForOwnerMock).not.toHaveBeenCalled();
  });

  it("deletes a document and returns the refreshed list", async () => {
    deleteDocumentForOwnerMock.mockResolvedValue([
      { id: "doc_next", fileName: "next.pdf", title: "next" },
    ]);
    const { DELETE } = await import("@/app/api/documents/[documentId]/route");

    const response = await DELETE(documentRequest("DELETE"), {
      params: Promise.resolve({ documentId: "doc_route" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.documents).toHaveLength(1);
    expect(deleteDocumentForOwnerMock).toHaveBeenCalledWith("owner_doc", "doc_route");
  });
});
