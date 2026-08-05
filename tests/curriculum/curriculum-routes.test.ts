// Route-layer tests for the curriculum API. Auth and rate limiting are
// mocked (per the repo's route-test convention); the service and the
// file-backed repository run for real against an isolated temporary data
// directory. Never touches Supabase.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createValidCurriculumDraft } from "./fixtures";

const authState = vi.hoisted(() => ({
  principalId: "user_curriculum_routes",
  unauthenticated: false,
}));
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => {
    if (authState.unauthenticated) {
      const { HttpError } = await import("@/lib/server/http");
      throw new HttpError("You need to sign in to do that.", {
        code: "AUTH_REQUIRED",
        expose: true,
        status: 401,
      });
    }
    return {
      principal: { id: authState.principalId, email: null, authMode: "local" as const },
      session: { id: authState.principalId, isNew: false },
    };
  }),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-curriculum-routes-"));
  vi.stubEnv("ENABLE_CURRICULUM_AGENT", "true");
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  // withIdempotency persists replay records through the agent-run repository;
  // keep that store inside the same isolated tmpdir.
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
  authState.principalId = "user_curriculum_routes";
  authState.unauthenticated = false;
  checkRateLimitAsyncMock.mockReset();
  checkRateLimitAsyncMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

function jsonRequest(url: string, method: string, body?: unknown, idempotencyKey?: string) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createCurriculum(body: unknown, idempotencyKey?: string) {
  const { POST } = await import("@/app/api/curricula/route");
  return POST(jsonRequest("/api/curricula", "POST", body, idempotencyKey));
}

describe("curriculum routes", () => {
  it("returns 404 while the curriculum agent flag is off", async () => {
    vi.stubEnv("ENABLE_CURRICULUM_AGENT", "");

    const response = await createCurriculum({ title: "Course", learningGoal: "Learn." });

    expect(response.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    authState.unauthenticated = true;
    const { GET } = await import("@/app/api/curricula/route");

    const response = await GET(jsonRequest("/api/curricula", "GET"));

    expect(response.status).toBe(401);
  });

  it("returns an informational local quota when the curriculum flag is enabled", async () => {
    const { GET } = await import("@/app/api/curricula/generate/quota/route");

    const response = await GET(jsonRequest("/api/curricula/generate/quota", "GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      quota: {
        tracked: false,
        used: 0,
        limit: null,
        remaining: null,
      },
    });
  });

  it("hides the quota endpoint while the curriculum flag is off", async () => {
    vi.stubEnv("ENABLE_CURRICULUM_AGENT", "");
    const { GET } = await import("@/app/api/curricula/generate/quota/route");

    const response = await GET(jsonRequest("/api/curricula/generate/quota", "GET"));

    expect(response.status).toBe(404);
  });

  it("lists the signed-in user's curricula for the entry page", async () => {
    await createCurriculum({ title: "Course A", learningGoal: "Learn A." });
    await createCurriculum({ title: "Course B", learningGoal: "Learn B." });
    const { GET } = await import("@/app/api/curricula/route");

    const response = await GET(jsonRequest("/api/curricula", "GET"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.curricula.map((curriculum: { title: string }) => curriculum.title)).toEqual([
      "Course B",
      "Course A",
    ]);
  });

  it("rejects an invalid create body with 400", async () => {
    const response = await createCurriculum({ title: "", learningGoal: "Learn." });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid draft body with 400", async () => {
    const createResponse = await createCurriculum({ title: "Course", learningGoal: "Learn." });
    const { curriculum } = await createResponse.json();

    const { POST } = await import("@/app/api/curricula/[curriculumId]/versions/route");
    const response = await POST(
      jsonRequest(`/api/curricula/${curriculum.id}/versions`, "POST", { title: "not a draft" }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 429 when the rate limit is hit", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });

    const response = await createCurriculum({ title: "Course", learningGoal: "Learn." });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("runs the create → draft version → publish flow end to end", async () => {
    const createResponse = await createCurriculum({
      title: "Foundations of Testing",
      subject: "Software Testing",
      learningGoal: "Be able to design and run a reliable test suite.",
    });
    expect(createResponse.status).toBe(201);
    const { curriculum } = await createResponse.json();
    expect(curriculum.status).toBe("draft");
    expect(curriculum.ownerUserId).toBe("user_curriculum_routes");

    const { POST: createVersion, GET: listVersions } = await import(
      "@/app/api/curricula/[curriculumId]/versions/route"
    );
    const versionResponse = await createVersion(
      jsonRequest(
        `/api/curricula/${curriculum.id}/versions`,
        "POST",
        createValidCurriculumDraft(),
      ),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    expect(versionResponse.status).toBe(201);
    const createdVersion = await versionResponse.json();
    expect(createdVersion.version.versionNumber).toBe(1);
    expect(createdVersion.version.status).toBe("draft");
    expect(createdVersion.draft.modules).toHaveLength(2);
    expect(createdVersion.validation.blockingCount).toBe(0);

    const { GET: getVersion } = await import(
      "@/app/api/curricula/[curriculumId]/versions/[versionId]/route"
    );
    const versionDetailResponse = await getVersion(
      jsonRequest(`/api/curricula/${curriculum.id}/versions/${createdVersion.version.id}`, "GET"),
      {
        params: Promise.resolve({
          curriculumId: curriculum.id,
          versionId: createdVersion.version.id,
        }),
      },
    );
    expect(versionDetailResponse.status).toBe(200);
    const versionDetail = await versionDetailResponse.json();
    expect(versionDetail.version.id).toBe(createdVersion.version.id);
    expect(versionDetail.draft.sources).toHaveLength(5);

    const { PATCH, DELETE } = await import("@/app/api/curricula/[curriculumId]/route");
    const patchResponse = await PATCH(
      jsonRequest(`/api/curricula/${curriculum.id}`, "PATCH", { title: "Testing Foundations" }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).curriculum.title).toBe("Testing Foundations");

    const { POST: publish } = await import("@/app/api/curricula/[curriculumId]/publish/route");
    const publishResponse = await publish(
      jsonRequest(`/api/curricula/${curriculum.id}/publish`, "POST", {
        versionId: createdVersion.version.id,
        confirmation: true,
      }),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    expect(publishResponse.status).toBe(200);
    const { version: publishedVersion } = await publishResponse.json();
    expect(publishedVersion.status).toBe("published");
    expect(publishedVersion.publishedAt).toBeTruthy();

    const { PATCH: patchVersion } = await import(
      "@/app/api/curricula/[curriculumId]/versions/[versionId]/route"
    );
    const patchPublishedResponse = await patchVersion(
      jsonRequest(
        `/api/curricula/${curriculum.id}/versions/${createdVersion.version.id}`,
        "PATCH",
        { versionLabel: "must remain immutable" },
      ),
      {
        params: Promise.resolve({
          curriculumId: curriculum.id,
          versionId: createdVersion.version.id,
        }),
      },
    );
    expect(patchPublishedResponse.status).toBe(409);
    expect((await patchPublishedResponse.json()).error.code).toBe(
      "CURRICULUM_VERSION_NOT_DRAFT",
    );

    const listResponse = await listVersions(
      jsonRequest(`/api/curricula/${curriculum.id}/versions`, "GET"),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    expect(listResponse.status).toBe(200);
    const { versions } = await listResponse.json();
    expect(versions).toHaveLength(1);
    expect(versions[0].status).toBe("published");

    const deleteResponse = await DELETE(jsonRequest(`/api/curricula/${curriculum.id}`, "DELETE"), {
      params: Promise.resolve({ curriculumId: curriculum.id }),
    });
    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).curriculum.status).toBe("archived");
  });

  it("returns 404 when another user reads the curriculum", async () => {
    const createResponse = await createCurriculum({ title: "Course", learningGoal: "Learn." });
    const { curriculum } = await createResponse.json();

    authState.principalId = "user_other";
    const { GET } = await import("@/app/api/curricula/[curriculumId]/route");
    const response = await GET(jsonRequest(`/api/curricula/${curriculum.id}`, "GET"), {
      params: Promise.resolve({ curriculumId: curriculum.id }),
    });

    expect(response.status).toBe(404);
  });

  it("edits a draft, derives a new draft, and returns a version diff", async () => {
    const createResponse = await createCurriculum({
      title: "Versioned Course",
      learningGoal: "Learn versioning.",
    });
    const { curriculum } = await createResponse.json();

    const { POST: createVersion } = await import(
      "@/app/api/curricula/[curriculumId]/versions/route"
    );
    const createdResponse = await createVersion(
      jsonRequest(`/api/curricula/${curriculum.id}/versions`, "POST", createValidCurriculumDraft()),
      { params: Promise.resolve({ curriculumId: curriculum.id }) },
    );
    const created = await createdResponse.json();
    expect(createdResponse.status).toBe(201);

    const { GET: getVersion, PATCH } = await import(
      "@/app/api/curricula/[curriculumId]/versions/[versionId]/route"
    );
    const detailResponse = await getVersion(
      jsonRequest(`/api/curricula/${curriculum.id}/versions/${created.version.id}`, "GET"),
      {
        params: Promise.resolve({ curriculumId: curriculum.id, versionId: created.version.id }),
      },
    );
    const detail = await detailResponse.json();

    const patchResponse = await PATCH(
      jsonRequest(
        `/api/curricula/${curriculum.id}/versions/${created.version.id}`,
        "PATCH",
        {
          versionLabel: "Edited version",
          modules: {
            upsert: [
              {
                ...detail.draft.modules[0],
                nodes: undefined,
                title: "Edited module",
              },
            ],
          },
        },
      ),
      {
        params: Promise.resolve({ curriculumId: curriculum.id, versionId: created.version.id }),
      },
    );
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json();
    expect(patched.version.versionLabel).toBe("Edited version");
    expect(patched.draft.modules[0].title).toBe("Edited module");

    const { POST: derive } = await import(
      "@/app/api/curricula/[curriculumId]/versions/[versionId]/derive/route"
    );
    const derivedResponse = await derive(
      jsonRequest(
        `/api/curricula/${curriculum.id}/versions/${created.version.id}/derive`,
        "POST",
      ),
      { params: Promise.resolve({ curriculumId: curriculum.id, versionId: created.version.id }) },
    );
    expect(derivedResponse.status).toBe(201);
    const derived = await derivedResponse.json();
    expect(derived.version.versionNumber).toBe(2);
    expect(derived.version.status).toBe("draft");

    const { GET: getDiff } = await import(
      "@/app/api/curricula/[curriculumId]/versions/[versionId]/diff/route"
    );
    const diffResponse = await getDiff(
      new NextRequest(
        `http://localhost/api/curricula/${curriculum.id}/versions/${derived.version.id}/diff?against=${created.version.id}`,
      ),
      { params: Promise.resolve({ curriculumId: curriculum.id, versionId: derived.version.id }) },
    );
    expect(diffResponse.status).toBe(200);
    const { diff } = await diffResponse.json();
    expect(diff.modules).toHaveLength(0);
    expect(diff.nodes).toHaveLength(0);
    expect(diff.edges).toHaveLength(0);
    expect(diff.sources).toHaveLength(0);
  });

  describe("idempotent replay (spec §11.5)", () => {
    it("replays the first create response for a repeated Idempotency-Key", async () => {
      const key = "curriculum-create-idem-1";
      const body = { title: "Idempotent Course", learningGoal: "Learn idempotency." };

      const firstResponse = await createCurriculum(body, key);
      expect(firstResponse.status).toBe(201);
      const first = await firstResponse.json();

      const secondResponse = await createCurriculum(body, key);
      expect(secondResponse.status).toBe(201);
      const second = await secondResponse.json();

      // The duplicate is served from the 24h idempotency store: the exact
      // first response comes back and the handler never re-runs.
      expect(second).toEqual(first);

      const { GET } = await import("@/app/api/curricula/route");
      const listResponse = await GET(jsonRequest("/api/curricula", "GET"));
      const { curricula } = await listResponse.json();
      expect(curricula).toHaveLength(1);
      expect(curricula[0].id).toBe(first.curriculum.id);
    });

    it("replays the first publish response for a repeated Idempotency-Key", async () => {
      const createResponse = await createCurriculum({
        title: "Publish Course",
        learningGoal: "Learn publishing.",
      });
      const { curriculum } = await createResponse.json();

      const { POST: createVersion, GET: listVersions } = await import(
        "@/app/api/curricula/[curriculumId]/versions/route"
      );
      const versionResponse = await createVersion(
        jsonRequest(
          `/api/curricula/${curriculum.id}/versions`,
          "POST",
          createValidCurriculumDraft(),
        ),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const created = await versionResponse.json();

      const { POST: publish } = await import("@/app/api/curricula/[curriculumId]/publish/route");
      const key = "curriculum-publish-idem-1";
      const publishBody = { versionId: created.version.id, confirmation: true };

      const firstResponse = await publish(
        jsonRequest(`/api/curricula/${curriculum.id}/publish`, "POST", publishBody, key),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      expect(first.version.status).toBe("published");

      const secondResponse = await publish(
        jsonRequest(`/api/curricula/${curriculum.id}/publish`, "POST", publishBody, key),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      // A re-executed publish would 409 (the version is no longer a draft);
      // a 200 replay proves the stored first response was served instead.
      expect(secondResponse.status).toBe(200);
      const second = await secondResponse.json();
      expect(second).toEqual(first);

      const listResponse = await listVersions(
        jsonRequest(`/api/curricula/${curriculum.id}/versions`, "GET"),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const { versions } = await listResponse.json();
      expect(versions).toHaveLength(1);
      expect(versions[0].status).toBe("published");
      expect(versions[0].publishedAt).toBe(first.version.publishedAt);
    });

    it("replays the first derive response for a repeated Idempotency-Key", async () => {
      const createResponse = await createCurriculum({
        title: "Derive Course",
        learningGoal: "Learn deriving.",
      });
      const { curriculum } = await createResponse.json();

      const { POST: createVersion, GET: listVersions } = await import(
        "@/app/api/curricula/[curriculumId]/versions/route"
      );
      const versionResponse = await createVersion(
        jsonRequest(
          `/api/curricula/${curriculum.id}/versions`,
          "POST",
          createValidCurriculumDraft(),
        ),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const created = await versionResponse.json();

      const { POST: derive } = await import(
        "@/app/api/curricula/[curriculumId]/versions/[versionId]/derive/route"
      );
      const key = "curriculum-derive-idem-1";
      const deriveContext = {
        params: Promise.resolve({ curriculumId: curriculum.id, versionId: created.version.id }),
      };

      const firstResponse = await derive(
        jsonRequest(
          `/api/curricula/${curriculum.id}/versions/${created.version.id}/derive`,
          "POST",
          undefined,
          key,
        ),
        deriveContext,
      );
      expect(firstResponse.status).toBe(201);
      const first = await firstResponse.json();
      expect(first.version.versionNumber).toBe(2);

      const secondResponse = await derive(
        jsonRequest(
          `/api/curricula/${curriculum.id}/versions/${created.version.id}/derive`,
          "POST",
          undefined,
          key,
        ),
        deriveContext,
      );
      // A re-executed derive would create a third version with a new id; the
      // replay returns the first derived version instead.
      expect(secondResponse.status).toBe(201);
      const second = await secondResponse.json();
      expect(second).toEqual(first);

      const listResponse = await listVersions(
        jsonRequest(`/api/curricula/${curriculum.id}/versions`, "GET"),
        { params: Promise.resolve({ curriculumId: curriculum.id }) },
      );
      const { versions } = await listResponse.json();
      expect(versions).toHaveLength(2);
      expect(versions.map((entry: { id: string }) => entry.id).sort()).toEqual(
        [created.version.id, first.version.id].sort(),
      );
    });
  });
});
