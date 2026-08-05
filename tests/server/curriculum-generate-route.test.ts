import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";

const originalEnv = process.env;

describe("POST /api/curricula/generate", () => {
  let dataDir: string;
  let ownerId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-curriculum-generate-"));
    ownerId = `local-owner-${Date.now()}-${crypto.randomUUID()}`;
    vi.resetModules();
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

  it("streams stage events and saves a draft version end-to-end", async () => {
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

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const events = text
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const lines = block.split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
        return { event, data: data ? JSON.parse(data) : null };
      });

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("stage_started");
    expect(eventTypes).toContain("draft_saved");
    expect(eventTypes).toContain("run_completed");

    const completed = events.find((e) => e.event === "run_completed");
    expect(completed?.data?.curriculumVersionId).toBeTruthy();

    // Monotonic seq across events of the same run.
    const seqs = events.map((e) => e.data?.seq).filter((n): n is number => typeof n === "number");
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
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
