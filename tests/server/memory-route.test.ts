import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetInMemoryUserMemoryForTests } from "@/lib/server/user-memory";

const getBranchMindAuthContextMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());
const getExistingSessionIdMock = vi.hoisted(() => vi.fn());
const getOrCreateSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session_mem_test", isNew: false })),
);
const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: getBranchMindAuthContextMock,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/session")>();
  return {
    ...actual,
    getExistingSessionId: getExistingSessionIdMock,
    getOrCreateSession: getOrCreateSessionMock,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: vi.fn(),
}));

function memoryGetRequest() {
  return new NextRequest("http://localhost/api/memory", {
    method: "GET",
  });
}

function memoryPatchRequest(body: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/memory", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

function memoryDeleteRequest(origin = "http://localhost") {
  return new NextRequest("http://localhost/api/memory", {
    method: "DELETE",
    headers: {
      Origin: origin,
    },
  });
}

describe("/api/memory route", () => {
  beforeEach(() => {
    resetInMemoryUserMemoryForTests();
    getBranchMindAuthContextMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getExistingSessionIdMock.mockReset();
    hasSupabaseServerConfigMock.mockReset();

    hasSupabaseServerConfigMock.mockReturnValue(false);
    getExistingSessionIdMock.mockReturnValue("owner_mem_1");
    getBranchMindAuthContextMock.mockResolvedValue({
      principal: { id: "owner_mem_1", email: null, authMode: "local" },
      session: { id: "owner_mem_1", isNew: false },
    });
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      storage: "map",
    });
  });

  it("returns an empty read-only snapshot on GET when local guest has no session cookie", async () => {
    getExistingSessionIdMock.mockReturnValue(null);
    const { GET } = await import("@/app/api/memory/route");

    const response = await GET(memoryGetRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(payload.memory).toEqual({
      ownerId: "",
      profileSummary: "",
      preferredStyle: "",
      concepts: [],
      updatedAt: null,
    });
    expect(getBranchMindAuthContextMock).not.toHaveBeenCalled();
  });

  it("supports full round-trip PATCH, GET, concept removal, and DELETE", async () => {
    const { GET, PATCH, DELETE } = await import("@/app/api/memory/route");

    const patchRes1 = await PATCH(
      memoryPatchRequest({
        profileSummary: "CS master's student",
        preferredStyle: "Intuition first; include Python examples",
        upsertConcepts: [
          {
            concept: "Spectral Clustering",
            status: "struggling",
            note: "Graph Laplacian eigenvectors",
          },
          {
            concept: "K-Means",
            status: "mastered",
          },
        ],
      }),
    );
    const patchBody1 = await patchRes1.json();

    expect(patchRes1.status).toBe(200);
    expect(patchRes1.headers.get("x-request-id")).toBeTruthy();
    expect(patchBody1.memory.profileSummary).toBe("CS master's student");
    expect(patchBody1.memory.preferredStyle).toBe(
      "Intuition first; include Python examples",
    );
    expect(patchBody1.memory.concepts).toHaveLength(2);

    const kMeansConcept = patchBody1.memory.concepts.find(
      (c: { conceptKey: string }) => c.conceptKey === "k-means",
    );
    expect(kMeansConcept).toBeDefined();

    // Remove one concept by ID and update the other's status
    const patchRes2 = await PATCH(
      memoryPatchRequest({
        removeConceptIds: [kMeansConcept.id],
        upsertConcepts: [
          {
            concept: "Spectral Clustering",
            status: "learning",
            note: "Normalized cut relaxation",
          },
        ],
      }),
    );
    const patchBody2 = await patchRes2.json();
    expect(patchRes2.status).toBe(200);
    expect(patchBody2.memory.concepts).toHaveLength(1);
    expect(patchBody2.memory.concepts[0]).toMatchObject({
      concept: "Spectral Clustering",
      status: "learning",
      note: "Normalized cut relaxation",
    });

    // Verify GET returns the updated snapshot
    const getRes = await GET(memoryGetRequest());
    const getBody = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getBody.memory.concepts).toHaveLength(1);

    // Clear all memory via DELETE
    const delRes = await DELETE(memoryDeleteRequest());
    const delBody = await delRes.json();
    expect(delRes.status).toBe(200);
    expect(delBody).toEqual({ ok: true });

    const getAfterDel = await GET(memoryGetRequest());
    const afterDelBody = await getAfterDel.json();
    expect(afterDelBody.memory.profileSummary).toBe("");
    expect(afterDelBody.memory.concepts).toEqual([]);
  });

  it("validates PATCH payload strictly with 400 VALIDATION_FAILED", async () => {
    const { PATCH } = await import("@/app/api/memory/route");

    const invalidPayloads = [
      { profileSummary: "x".repeat(501) },
      { upsertConcepts: [{ concept: "PCA", status: "unknown_status" }] },
      { unknownField: true },
    ];

    for (const body of invalidPayloads) {
      const res = await PATCH(memoryPatchRequest(body));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error.code).toBe("VALIDATION_FAILED");
    }
    expect(checkRateLimitAsyncMock).not.toHaveBeenCalled();
  });

  it("rejects untrusted origins on PATCH and DELETE with 403", async () => {
    const { PATCH, DELETE } = await import("@/app/api/memory/route");

    const patchRes = await PATCH(
      memoryPatchRequest({ profileSummary: "hi" }, "https://evil.example"),
    );
    expect(patchRes.status).toBe(403);

    const delRes = await DELETE(memoryDeleteRequest("https://evil.example"));
    expect(delRes.status).toBe(403);
  });

  it("enforces rate limits on PATCH and DELETE with 429 and Retry-After", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 25,
      storage: "map",
    });
    const { PATCH, DELETE } = await import("@/app/api/memory/route");

    const patchRes = await PATCH(memoryPatchRequest({ profileSummary: "hi" }));
    expect(patchRes.status).toBe(429);
    expect(patchRes.headers.get("Retry-After")).toBe("25");

    const delRes = await DELETE(memoryDeleteRequest());
    expect(delRes.status).toBe(429);
    expect(delRes.headers.get("Retry-After")).toBe("25");
  });
});
