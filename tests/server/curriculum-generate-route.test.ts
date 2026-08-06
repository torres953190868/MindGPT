import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";

const createAndEnqueueCurriculumJobMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/curriculum-builder/curriculum-jobs", () => ({
  createAndEnqueueCurriculumJob: createAndEnqueueCurriculumJobMock,
}));

const originalEnv = process.env;

describe("POST /api/curricula/generate", () => {
  let dataDir: string;
  let ownerId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-curriculum-generate-"));
    ownerId = `local-owner-${Date.now()}-${crypto.randomUUID()}`;
    vi.resetModules();
    createAndEnqueueCurriculumJobMock.mockReset();
    createAndEnqueueCurriculumJobMock.mockResolvedValue({ id: "run_queued", status: "queued" });
    process.env = {
      ...originalEnv,
      AI_MOCK_MODE: "true",
      ENABLE_CURRICULUM_AGENT: "true",
      BRANCHMIND_CURRICULUM_BACKEND: "file",
      BRANCHMIND_CURRICULUM_DATA_DIR: dataDir,
      BRANCHMIND_AGENT_RUNS_DATA_DIR: dataDir,
      NODE_ENV: "test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createRequest(body: Record<string, unknown>, idempotencyKey: string | null = `gen-route-${Date.now()}`) {
    return new NextRequest("http://localhost/api/curricula/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        Cookie: `branchmind_session=${ownerId}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("queues a curriculum run and returns its durable run id", async () => {
    const { POST } = await import("@/app/api/curricula/generate/route");
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "机器学习",
      subject: "机器学习",
      learningGoal: "能够独立完成常见机器学习项目",
    });

    const response = await POST(
      createRequest({
        curriculumId: curriculum.id,
        subject: "机器学习",
        learnerProfile: { currentLevel: "beginner", knownSkills: ["Python"] },
        learningGoal: "能够独立完成常见机器学习项目",
        constraints: {
          durationWeeks: 12,
          hoursPerWeek: 5,
          includeMathDepth: "deep",
          includeProjects: true,
        },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ runId: "run_queued", status: "queued" });
    expect(createAndEnqueueCurriculumJobMock).toHaveBeenCalledWith(expect.objectContaining({
      ownerId,
      curriculumId: curriculum.id,
      idempotencyKey: expect.any(String),
    }));
  });

  it("rejects a missing curriculumId", async () => {
    const { POST } = await import("@/app/api/curricula/generate/route");
    const response = await POST(
      createRequest({
        subject: "机器学习",
        learnerProfile: { currentLevel: "beginner" },
        learningGoal: "test",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a valid body that lacks the Idempotency-Key header", async () => {
    const { POST } = await import("@/app/api/curricula/generate/route");
    const response = await POST(
      createRequest(
        {
          curriculumId: "curriculum_any",
          subject: "机器学习",
          learnerProfile: { currentLevel: "beginner", knownSkills: [] },
          learningGoal: "test",
        },
        null,
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});
