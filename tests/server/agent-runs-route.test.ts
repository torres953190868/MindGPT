import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCurriculumDraft } from "@/lib/agents/curriculum-builder/curriculum-builder-agent";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";

const originalEnv = process.env;

describe("agent-runs routes", () => {
  let dataDir: string;
  let ownerId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-agent-routes-"));
    ownerId = `local-owner-${Date.now()}-${crypto.randomUUID()}`;
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AI_MOCK_MODE: "true",
      ENABLE_CURRICULUM_AGENT: "true",
      BRANCHMIND_CURRICULUM_BACKEND: "file",
      BRANCHMIND_CURRICULUM_DATA_DIR: dataDir,
      BRANCHMIND_AGENT_RUNS_DATA_DIR: dataDir,
      BRANCHMIND_AI_USAGE_DATA_DIR: dataDir,
      NODE_ENV: "test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function request(path: string, method = "GET", body?: Record<string, unknown>) {
    return new NextRequest(`http://localhost${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `branchmind_session=${ownerId}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("GET /api/agent-runs/:runId returns the run and its checkpoints", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "测试",
      subject: "测试",
      learningGoal: "测试",
    });
    const result = await generateCurriculumDraft({
      ownerId,
      curriculumId: curriculum.id,
      request: {
        subject: "测试学科",
        learnerProfile: { currentLevel: "beginner", knownSkills: [] },
        learningGoal: "测试",
      },
      idempotencyKey: `run-get-${Date.now()}`,
    });
    expect(result.status).toBe("succeeded");

    const { GET } = await import("@/app/api/agent-runs/[runId]/route");
    const response = await GET(request(`/api/agent-runs/${result.runId}`), {
      params: Promise.resolve({ runId: result.runId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run.id).toBe(result.runId);
    expect(body.run.status).toBe("succeeded");
    expect(body.run.output?.checkpoints).toBeTruthy();
  });

  it("GET /api/agent-runs/:runId/events returns persisted stream events", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "测试事件",
      subject: "测试事件",
      learningGoal: "测试事件",
    });
    const result = await generateCurriculumDraft({
      ownerId,
      curriculumId: curriculum.id,
      request: {
        subject: "测试事件学科",
        learnerProfile: { currentLevel: "beginner", knownSkills: [] },
        learningGoal: "测试事件",
      },
      idempotencyKey: `run-events-${Date.now()}`,
    });
    expect(result.status).toBe("succeeded");

    const { GET } = await import("@/app/api/agent-runs/[runId]/events/route");
    const response = await GET(
      request(`/api/agent-runs/${result.runId}/events?after=0`),
      { params: Promise.resolve({ runId: result.runId }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.length).toBeGreaterThan(0);
    const seqs = body.events.map((e: { event: { seq: number } }) => e.event.seq);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});
