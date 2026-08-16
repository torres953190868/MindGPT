// Tool-registry tests: the static CURRICULUM_TOOLS map owns each tool's name,
// input schema, executor, and budget dimension. The runner's dispatch path
// validates/times/records through it, and the resume-time budget restore
// reads the tool → budget-dimension mapping from here (rename-safety).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import {
  CURRICULUM_TOOLS,
  getCurriculumToolBudgetDimension,
} from "@/lib/agents/curriculum-builder/tools/tool-registry";
import { fetchWebPageToolInputSchema } from "@/lib/agents/curriculum-builder/tools/fetch-web-page-tool";
import { webSearchToolInputSchema } from "@/lib/agents/curriculum-builder/tools/web-search-tool";
import { createCurriculumForOwner } from "@/lib/curriculum/curriculum-service";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";
import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";
import type { WebSearchProvider } from "@/lib/research/web-search-provider";

describe("curriculum tool registry", () => {
  let dataDir: string;
  let ownerId: string;
  const originalEnv = process.env;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-curriculum-registry-"));
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

  it("owns the tool name → budget dimension mapping used by budget restore", () => {
    expect(getCurriculumToolBudgetDimension("webSearch")).toBe("searchQueries");
    expect(getCurriculumToolBudgetDimension("searchProjectDocuments")).toBe("searchQueries");
    expect(getCurriculumToolBudgetDimension("fetchWebPage")).toBe("fetchedPages");
    // Budget-free tools and unknown names restore nothing.
    expect(getCurriculumToolBudgetDimension("getExistingCurriculum")).toBeNull();
    expect(getCurriculumToolBudgetDimension("publishCurriculum")).toBeNull();
  });

  it("exposes each tool's own input schema (invalid input fails identically)", () => {
    // The registry reuses the tool modules' schema objects, so dispatch-time
    // validation is literally the same parse the tools ran internally.
    expect(CURRICULUM_TOOLS.webSearch.inputSchema).toBe(webSearchToolInputSchema);
    expect(CURRICULUM_TOOLS.fetchWebPage.inputSchema).toBe(fetchWebPageToolInputSchema);
    expect(() => CURRICULUM_TOOLS.webSearch.inputSchema.parse({ query: "" })).toThrow();
    expect(() => CURRICULUM_TOOLS.fetchWebPage.inputSchema.parse({ url: "", sourceId: "s1" })).toThrow();
    for (const [key, tool] of Object.entries(CURRICULUM_TOOLS)) {
      expect(tool.name).toBe(key);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("dispatch records tool steps with registry names and measured durations", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "注册表派发",
      learningGoal: "注册表派发",
    });
    const innerProvider = new MockWebSearchProvider();
    const slowProvider: WebSearchProvider = {
      id: "slow-mock",
      async search(input) {
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
        return innerProvider.search(input);
      },
    };

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request: buildRequest("注册表派发"),
      idempotencyKey: `registry-dispatch-${Date.now()}`,
      deps: { webSearchProvider: slowProvider },
    });
    expect(result.status).toBe("succeeded");

    const steps = await getAgentRunRepository().listSteps(result.runId);
    const searchSteps = steps.filter((step) => step.toolName === "webSearch");
    // The mock plan issues 3 queries; each went through the dispatch path.
    expect(searchSteps).toHaveLength(3);
    for (const step of searchSteps) {
      expect(step.stepType).toBe("tool");
      expect(step.status).toBe("succeeded");
      // Parsed input (registry schema) is what lands in the step row.
      expect((step.input as { query?: string }).query).toBeTruthy();
      // Measured, not hardcoded (25ms artificial delay leaves a safe margin).
      expect(step.durationMs).toBeGreaterThanOrEqual(20);
      expect(step.durationMs).toBeLessThan(10_000);
    }
    // The other registry tools recorded steps under their registry names too.
    expect(steps.some((step) => step.toolName === "getExistingCurriculum")).toBe(true);
    expect(steps.some((step) => step.toolName === "fetchWebPage")).toBe(true);
  });
});
