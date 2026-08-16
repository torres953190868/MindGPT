// Lifecycle-hook tests for the CurriculumBuilderAgent runner. Hooks are the
// runner's observability seam: they must fire in stage/model-call order with
// tiny payloads (stage/task/usage numbers — never prompt text), and a
// throwing hook must never fail the run.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBudgetTracker, CURRICULUM_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { MOCK_MODEL_USAGE } from "@/lib/agent-runtime/model-adapter";
import {
  runCurriculumBuilder,
  type CurriculumRunnerHooks,
} from "@/lib/agents/curriculum-builder/curriculum-runner";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";

describe("CurriculumBuilderAgent runner hooks", () => {
  let dataDir: string;
  let ownerId: string;
  const originalEnv = process.env;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-curriculum-hooks-"));
    ownerId = `test-owner-${Date.now()}`;
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AI_MOCK_MODE: "true",
      BRANCHMIND_CURRICULUM_BACKEND: "file",
      BRANCHMIND_CURRICULUM_DATA_DIR: dataDir,
      BRANCHMIND_AGENT_RUNS_DATA_DIR: dataDir,
      BRANCHMIND_AI_USAGE_DATA_DIR: dataDir,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function buildRequest(subject = "机器学习"): CurriculumBuildRequest {
    return {
      subject,
      learnerProfile: {
        currentLevel: "beginner",
        knownSkills: ["Python"],
      },
      learningGoal: `能够独立完成常见${subject}项目`,
      constraints: {
        durationWeeks: 12,
        hoursPerWeek: 5,
        includeProjects: true,
        includeMathDepth: "standard",
      },
    };
  }

  function recordingHooks() {
    const stageEvents: Array<string> = [];
    const stageOutcomes: Array<{ stage: string; ok: boolean; code?: string }> = [];
    const modelCalls: Array<{
      phase: "pre" | "post";
      task: string;
      stage: string;
      totalTokens?: number;
      errorCode?: string;
    }> = [];
    const hooks: CurriculumRunnerHooks = {
      preStage: (stage) => {
        stageEvents.push(`preStage:${stage}`);
      },
      postStage: (stage, outcome) => {
        stageEvents.push(`postStage:${stage}`);
        stageOutcomes.push(outcome.ok ? { stage, ok: true } : { stage, ok: false, code: outcome.code });
      },
      preModelCall: (meta) => {
        modelCalls.push({ phase: "pre", task: meta.task, stage: meta.stage });
      },
      postModelCall: (meta, result) => {
        modelCalls.push(
          result.ok
            ? { phase: "post", task: meta.task, stage: meta.stage, totalTokens: result.usage.totalTokens }
            : { phase: "post", task: meta.task, stage: meta.stage, errorCode: result.code },
        );
      },
    };
    return { hooks, stageEvents, stageOutcomes, modelCalls };
  }

  it("fires hooks in pipeline order with stage/task/usage payloads", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "钩子顺序",
      learningGoal: "钩子顺序",
    });
    const { hooks, stageEvents, stageOutcomes, modelCalls } = recordingHooks();

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request: buildRequest("钩子顺序"),
      idempotencyKey: `hooks-order-${Date.now()}`,
      deps: { hooks },
    });

    expect(result.status).toBe("succeeded");
    const stages = [
      "intake",
      "planning",
      "searching",
      "fetching_sources",
      "extracting_concepts",
      "building_graph",
      "validating",
      "saving_draft",
    ];
    expect(stageEvents).toEqual(stages.flatMap((stage) => [`preStage:${stage}`, `postStage:${stage}`]));
    expect(stageOutcomes).toEqual(stages.map((stage) => ({ stage, ok: true })));

    // pre→post pairs per model call, carrying the pipeline stage and task.
    const intakeCalls = modelCalls.filter((call) => call.stage === "intake");
    expect(intakeCalls.map((call) => call.phase)).toEqual(["pre", "post"]);
    expect(intakeCalls[0].task).toBe("curriculum_research");
    expect(intakeCalls[1].totalTokens).toBe(MOCK_MODEL_USAGE.totalTokens);

    // building_graph runs three model calls (skeleton + one per module); all
    // report the pipeline stage, and validation uses its own route task.
    expect(modelCalls.filter((call) => call.stage === "building_graph").map((call) => call.phase)).toEqual([
      "pre",
      "post",
      "pre",
      "post",
      "pre",
      "post",
    ]);
    const validationCalls = modelCalls.filter((call) => call.stage === "validating");
    expect(validationCalls.map((call) => call.phase)).toEqual(["pre", "post"]);
    expect(validationCalls[0].task).toBe("curriculum_validation");

    // Searching/fetching stages make tool calls, not model calls.
    expect(modelCalls.some((call) => call.stage === "searching")).toBe(false);
    expect(modelCalls.some((call) => call.stage === "fetching_sources")).toBe(false);
  });

  it("reports a stage failure with its error code and no model-call hooks", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "钩子失败",
      learningGoal: "钩子失败",
    });
    const { hooks, stageEvents, stageOutcomes, modelCalls } = recordingHooks();

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request: buildRequest("钩子失败"),
      idempotencyKey: `hooks-failure-${Date.now()}`,
      deps: {
        hooks,
        // The first consumeStep (intake) throws before any model call starts.
        budget: new AgentBudgetTracker({ ...CURRICULUM_AGENT_BUDGET, maxAgentSteps: 0 }),
      },
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("AGENT_BUDGET_EXHAUSTED");
    expect(stageEvents).toEqual(["preStage:intake", "postStage:intake"]);
    expect(stageOutcomes).toEqual([{ stage: "intake", ok: false, code: "AGENT_BUDGET_EXHAUSTED" }]);
    expect(modelCalls).toEqual([]);
  });

  it("swallows throwing hooks and still completes the run", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "钩子异常",
      learningGoal: "钩子异常",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const hooks: CurriculumRunnerHooks = {
        preStage: () => {
          throw new Error("preStage boom");
        },
        postModelCall: () => {
          throw new Error("postModelCall boom");
        },
      };

      const result = await runCurriculumBuilder({
        ownerId,
        curriculumId: curriculum.id,
        request: buildRequest("钩子异常"),
        idempotencyKey: `hooks-throwing-${Date.now()}`,
        deps: { hooks },
      });

      expect(result.status).toBe("succeeded");
      expect(result.curriculumVersionId).toBeTruthy();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
