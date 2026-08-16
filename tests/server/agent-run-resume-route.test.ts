import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRICULUM_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { cancelRun, createRun, getRun } from "@/lib/agent-runtime/agent-run-service";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";

const sendMock = vi.hoisted(() => vi.fn());
const runCurriculumBuilderMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/queue", () => ({ send: sendMock }));
vi.mock("@/lib/agents/curriculum-builder/curriculum-runner", () => ({
  runCurriculumBuilder: runCurriculumBuilderMock,
}));

const originalEnv = process.env;

describe("POST /api/agent-runs/:runId/resume", () => {
  let dataDir: string;
  let ownerId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-agent-resume-"));
    ownerId = `local-owner-${Date.now()}-${crypto.randomUUID()}`;
    vi.resetModules();
    sendMock.mockReset();
    runCurriculumBuilderMock.mockReset();
    runCurriculumBuilderMock.mockResolvedValue({ status: "succeeded" });
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

  function createRequest(runId: string, idempotencyKey: string | null = `resume-route-${Date.now()}`) {
    return new NextRequest(`http://localhost/api/agent-runs/${runId}/resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        Cookie: `branchmind_session=${ownerId}`,
      },
    });
  }

  async function createCancelledRun() {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "测试",
      subject: "测试",
      learningGoal: "测试",
    });
    const { run } = await createRun({
      agentType: "curriculum_builder",
      userId: ownerId,
      curriculumId: curriculum.id,
      idempotencyKey: `resume-setup-${Date.now()}-${crypto.randomUUID()}`,
      input: {
        subject: "测试学科",
        learnerProfile: { currentLevel: "beginner", knownSkills: [] },
        learningGoal: "测试",
      },
      budget: CURRICULUM_AGENT_BUDGET,
    });
    return cancelRun(ownerId, run.id);
  }

  it("returns 202 and enqueues a continuation job in queue mode", async () => {
    process.env.BRANCHMIND_CURRICULUM_QUEUE_MODE = "queue";
    const run = await createCancelledRun();

    const { POST } = await import("@/app/api/agent-runs/[runId]/resume/route");
    const response = await POST(createRequest(run.id), {
      params: Promise.resolve({ runId: run.id }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ runId: run.id, status: "queued" });
    expect(sendMock).toHaveBeenCalledWith(
      "curriculum-processing",
      expect.objectContaining({
        runId: run.id,
        ownerId,
        curriculumId: run.curriculumId,
      }),
      expect.objectContaining({ retentionSeconds: 24 * 60 * 60 }),
    );
    expect(runCurriculumBuilderMock).not.toHaveBeenCalled();
    await expect(getRun(ownerId, run.id)).resolves.toMatchObject({ status: "queued" });
  });

  it("returns 202 and runs the builder detached in inline mode", async () => {
    process.env.BRANCHMIND_CURRICULUM_QUEUE_MODE = "inline";
    const run = await createCancelledRun();

    const { POST } = await import("@/app/api/agent-runs/[runId]/resume/route");
    const response = await POST(createRequest(run.id), {
      params: Promise.resolve({ runId: run.id }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ runId: run.id, status: "queued" });
    expect(runCurriculumBuilderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        ownerId,
        curriculumId: run.curriculumId,
        runtimeMode: "inline",
      }),
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects resume of an active run", async () => {
    process.env.BRANCHMIND_CURRICULUM_QUEUE_MODE = "queue";
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "测试",
      subject: "测试",
      learningGoal: "测试",
    });
    const { run } = await createRun({
      agentType: "curriculum_builder",
      userId: ownerId,
      curriculumId: curriculum.id,
      idempotencyKey: `resume-active-${Date.now()}`,
      input: {
        subject: "测试学科",
        learnerProfile: { currentLevel: "beginner", knownSkills: [] },
        learningGoal: "测试",
      },
      budget: CURRICULUM_AGENT_BUDGET,
    });

    const { POST } = await import("@/app/api/agent-runs/[runId]/resume/route");
    const response = await POST(createRequest(run.id), {
      params: Promise.resolve({ runId: run.id }),
    });

    expect(response.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
    expect(runCurriculumBuilderMock).not.toHaveBeenCalled();
  });

  it("rejects a resume that lacks the Idempotency-Key header", async () => {
    process.env.BRANCHMIND_CURRICULUM_QUEUE_MODE = "queue";
    const run = await createCancelledRun();

    const { POST } = await import("@/app/api/agent-runs/[runId]/resume/route");
    const response = await POST(createRequest(run.id, null), {
      params: Promise.resolve({ runId: run.id }),
    });

    expect(response.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
    expect(runCurriculumBuilderMock).not.toHaveBeenCalled();
  });
});
