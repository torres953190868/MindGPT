// Opt-in live smoke test for the real curriculum model path. It deliberately
// uses file persistence and deterministic research tools, so it verifies the
// model-output contract without creating production data or making web calls.
// Run manually with: RUN_LIVE_CURRICULUM_AGENT_SMOKE=true npm run test -- <file>

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import { createAgentModelAdapter } from "@/lib/agent-runtime/model-adapter";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";
import { MockSafeWebFetcher } from "@/lib/research/mock-safe-web-fetcher";
import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";

const runLiveSmoke = process.env.RUN_LIVE_CURRICULUM_AGENT_SMOKE === "true";

describe("live curriculum agent smoke", () => {
  const originalEnv = process.env;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-live-curriculum-agent-"));
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AI_MOCK_MODE: "false",
      BRANCHMIND_CURRICULUM_BACKEND: "file",
      BRANCHMIND_CURRICULUM_DATA_DIR: dataDir,
      BRANCHMIND_AGENT_RUNS_DATA_DIR: dataDir,
      BRANCHMIND_AI_USAGE_DATA_DIR: dataDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it.runIf(runLiveSmoke)("runs a real model through the full curriculum pipeline", async () => {
    const ownerId = `live-smoke-${Date.now()}`;
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "机器学习基础",
      subject: "机器学习基础",
      learningGoal: "理解监督学习的基本流程，并能完成一个简单分类任务。",
    });

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      idempotencyKey: `live-smoke-${Date.now()}`,
      request: {
        subject: "机器学习基础",
        learnerProfile: { currentLevel: "beginner", knownSkills: ["Python"] },
        learningGoal: "理解监督学习的基本流程，并能完成一个简单分类任务。",
        constraints: { durationWeeks: 2, hoursPerWeek: 3, includeMathDepth: "light" },
      },
      // Keep this test deterministic except for the model output itself.
      // It must still complete every model stage and persist a draft.
      runtimeMode: "inline",
      deps: {
        modelAdapter: createAgentModelAdapter(),
        webSearchProvider: new MockWebSearchProvider(),
        safeWebFetcher: new MockSafeWebFetcher(),
      },
    });

    expect(result.status, result.errorMessage).toBe("succeeded");
    expect(result.curriculumVersionId).toBeTruthy();
  }, 240_000);
});
