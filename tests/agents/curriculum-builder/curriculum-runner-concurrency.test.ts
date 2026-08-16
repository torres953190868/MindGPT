// Bounded-concurrency tests for the CurriculumBuilderAgent runner. The
// searching / fetching / per-module synthesis loops run with bounded
// parallelism; these tests prove the overlap is real, that results merge in
// deterministic input order, and that budget/cancel semantics are unchanged.
// Mock-script determinism (serial module synthesis under MockModelAdapter) is
// covered by the full-pipeline suite in curriculum-runner.test.ts.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBudgetTracker, CURRICULUM_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import {
  MockModelAdapter,
  type AgentModelActionRequest,
  type AgentModelAdapter,
} from "@/lib/agent-runtime/model-adapter";
import { buildMockCurriculumScript } from "@/lib/agents/curriculum-builder/mock-curriculum-script";
import { CURRICULUM_STAGE_MARKERS } from "@/lib/agents/curriculum-builder/curriculum-builder-prompts";
import { runCurriculumBuilder } from "@/lib/agents/curriculum-builder/curriculum-runner";
import {
  createCurriculumForOwner,
  getVersionForOwner,
  listVersionsForOwner,
} from "@/lib/curriculum/curriculum-service";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";
import { MockSafeWebFetcher } from "@/lib/research/mock-safe-web-fetcher";
import { MockWebSearchProvider } from "@/lib/research/mock-web-search-provider";
import type { SafeWebFetcher } from "@/lib/research/safe-web-fetcher";
import type { WebSearchProvider } from "@/lib/research/web-search-provider";

const MODULE_MARKER_PREFIX = "【CB-MODULE:";

function isModuleNodesCall(request: AgentModelActionRequest<unknown>): boolean {
  return request.contextMessages.some((message) => message.content.includes(MODULE_MARKER_PREFIX));
}

describe("CurriculumBuilderAgent runner concurrency", () => {
  let dataDir: string;
  let ownerId: string;
  const originalEnv = process.env;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bm-curriculum-concurrency-"));
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

  it("overlaps per-module synthesis and merges modules in skeleton order", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "并行合成",
      learningGoal: "并行合成",
    });
    const request = buildRequest("并行合成");
    const inner = new MockModelAdapter(buildMockCurriculumScript(request));

    let inFlight = 0;
    let maxInFlight = 0;
    let startedModuleCalls = 0;
    const releaseGates: Array<() => void> = [];
    // Delegates to the scripted mock but is NOT a MockModelAdapter instance,
    // so the runner takes the parallel module-synthesis path.
    const adapter: AgentModelAdapter = {
      async completeAction<T>(actionRequest: AgentModelActionRequest<T>) {
        if (!isModuleNodesCall(actionRequest)) return inner.completeAction<T>(actionRequest);
        startedModuleCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Hold the first module call until the second one starts: without real
        // overlap this gate would never open.
        if (startedModuleCalls === 1) {
          await new Promise<void>((resolve) => {
            releaseGates.push(resolve);
          });
        } else {
          for (const release of releaseGates.splice(0)) release();
        }
        // m-1 finishes after m-2 on purpose: the merged draft must follow
        // skeleton order, not completion order.
        if (
          actionRequest.contextMessages.some((message) =>
            message.content.includes(CURRICULUM_STAGE_MARKERS.moduleNodes("m-1")),
          )
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        inFlight -= 1;
        return inner.completeAction<T>(actionRequest);
      },
    };

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request,
      idempotencyKey: `conc-modules-${Date.now()}`,
      deps: { modelAdapter: adapter },
    });

    expect(result.status).toBe("succeeded");
    expect(startedModuleCalls).toBe(2);
    // Real overlap, still bounded (MODULE_SYNTHESIS_CONCURRENCY is 3).
    expect(maxInFlight).toBe(2);
    expect(maxInFlight).toBeLessThanOrEqual(3);

    const version = await getVersionForOwner(ownerId, curriculum.id, result.curriculumVersionId!);
    // Persistence rewrites clientIds to server ids; titles prove the merge
    // kept skeleton order despite m-2 completing before m-1.
    expect(version.draft.modules.map((courseModule) => courseModule.title)).toEqual([
      "并行合成基础",
      "并行合成实践",
    ]);
    expect(
      version.draft.modules.flatMap((courseModule) => courseModule.nodes.map((node) => node.title)),
    ).toEqual(["并行合成基础概念", "并行合成核心方法", "并行合成基础自测", "并行合成实践流程", "并行合成综合项目"]);
  });

  it("fails with AGENT_BUDGET_EXHAUSTED when the step budget runs out mid module batch", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "并行预算",
      learningGoal: "并行预算",
    });
    const request = buildRequest("并行预算");
    const inner = new MockModelAdapter(buildMockCurriculumScript(request));
    const adapter: AgentModelAdapter = {
      completeAction: <T>(actionRequest: AgentModelActionRequest<T>) => inner.completeAction<T>(actionRequest),
    };
    // intake + planning + extraction + skeleton consume 4 agent steps, leaving
    // headroom for exactly one of the two parallel module calls.
    const budget = new AgentBudgetTracker({ ...CURRICULUM_AGENT_BUDGET, maxAgentSteps: 5 });

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request,
      idempotencyKey: `conc-budget-${Date.now()}`,
      deps: { modelAdapter: adapter, budget },
    });

    // The first budget rejection fails the stage/run as-is — not retried into
    // AGENT_INVALID_MODEL_OUTPUT and not converted to a partial draft.
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("AGENT_BUDGET_EXHAUSTED");
    expect(await listVersionsForOwner(ownerId, curriculum.id)).toEqual([]);
  });

  it("overlaps searches and fetches while keeping source order deterministic", async () => {
    const request = buildRequest("并行抓取");

    // Reference run with the plain mocks (near-instant completion order).
    const referenceCurriculum = await createCurriculumForOwner(ownerId, {
      title: "抓取基线",
      learningGoal: "抓取基线",
    });
    const reference = await runCurriculumBuilder({
      ownerId,
      curriculumId: referenceCurriculum.id,
      request,
      idempotencyKey: `conc-fetch-ref-${Date.now()}`,
    });
    expect(reference.status).toBe("succeeded");

    let searchInFlight = 0;
    let maxSearchInFlight = 0;
    let fetchInFlight = 0;
    let maxFetchInFlight = 0;
    const innerProvider = new MockWebSearchProvider();
    const delayingProvider: WebSearchProvider = {
      id: "delaying-search",
      async search(input) {
        searchInFlight += 1;
        maxSearchInFlight = Math.max(maxSearchInFlight, searchInFlight);
        await new Promise((resolve) => setTimeout(resolve, 25));
        searchInFlight -= 1;
        return innerProvider.search(input);
      },
    };
    const innerFetcher = new MockSafeWebFetcher();
    const delayingFetcher: SafeWebFetcher = {
      id: "delaying-fetch",
      async fetch(url) {
        fetchInFlight += 1;
        maxFetchInFlight = Math.max(maxFetchInFlight, fetchInFlight);
        await new Promise((resolve) => setTimeout(resolve, 25));
        fetchInFlight -= 1;
        return innerFetcher.fetch(url);
      },
    };

    const parallelCurriculum = await createCurriculumForOwner(ownerId, {
      title: "并行抓取",
      learningGoal: "并行抓取",
    });
    const parallel = await runCurriculumBuilder({
      ownerId,
      curriculumId: parallelCurriculum.id,
      request,
      idempotencyKey: `conc-fetch-par-${Date.now()}`,
      deps: { webSearchProvider: delayingProvider, safeWebFetcher: delayingFetcher },
    });
    expect(parallel.status).toBe("succeeded");

    // The delay keeps every lane busy: overlap must exceed 1 and stay within
    // the SEARCH_FETCH_CONCURRENCY limit of 3.
    expect(maxSearchInFlight).toBeGreaterThan(1);
    expect(maxSearchInFlight).toBeLessThanOrEqual(3);
    expect(maxFetchInFlight).toBeGreaterThan(1);
    expect(maxFetchInFlight).toBeLessThanOrEqual(3);

    // Delayed/interleaved completion does not change source selection order.
    const referenceVersion = await getVersionForOwner(ownerId, referenceCurriculum.id, reference.curriculumVersionId!);
    const parallelVersion = await getVersionForOwner(ownerId, parallelCurriculum.id, parallel.curriculumVersionId!);
    expect(parallelVersion.draft.sources.map((source) => source.url)).toEqual(
      referenceVersion.draft.sources.map((source) => source.url),
    );
  });

  it("keeps module synthesis serial when the adapter is a MockModelAdapter", async () => {
    const curriculum = await createCurriculumForOwner(ownerId, {
      title: "串行脚本",
      learningGoal: "串行脚本",
    });
    const request = buildRequest("串行脚本");

    let inFlight = 0;
    let maxInFlight = 0;
    // A MockModelAdapter (even subclassed) consumes a scripted queue, so the
    // runner must not parallelize module synthesis behind its back.
    class TrackingMockAdapter extends MockModelAdapter {
      override async completeAction<T>(actionRequest: AgentModelActionRequest<T>) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield long enough that any parallel sibling would overlap.
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          return await super.completeAction<T>(actionRequest);
        } finally {
          inFlight -= 1;
        }
      }
    }

    const result = await runCurriculumBuilder({
      ownerId,
      curriculumId: curriculum.id,
      request,
      idempotencyKey: `conc-mock-serial-${Date.now()}`,
      deps: { modelAdapter: new TrackingMockAdapter(buildMockCurriculumScript(request)) },
    });

    expect(result.status).toBe("succeeded");
    expect(maxInFlight).toBe(1);
  });
});
