import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eqMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => ({
    from: fromMock,
  }),
  hasSupabaseServerConfig: () => true,
  requireSupabaseServerConfig: vi.fn(),
}));

const originalRagBackend = process.env.BRANCHMIND_RAG_BACKEND;

describe("rag store", () => {
  beforeEach(() => {
    process.env.BRANCHMIND_RAG_BACKEND = "supabase";
    eqMock.mockReset();
    selectMock.mockReset();
    fromMock.mockReset();
    eqMock.mockResolvedValue({ count: 7, error: null });
    selectMock.mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });
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
});
