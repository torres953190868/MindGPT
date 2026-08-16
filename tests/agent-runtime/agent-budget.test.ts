// Unit tests for the agent budget tracker (spec §11.4): every dimension
// throws AgentError(AGENT_BUDGET_EXHAUSTED) with the exceeded dimension, and
// runtime checks are driven by an injected fake clock.

import { describe, expect, it } from "vitest";
import {
  AgentBudgetTracker,
  CURRICULUM_AGENT_BUDGET,
  TUTOR_AGENT_BUDGET,
  type AgentBudgetLimits,
} from "@/lib/agent-runtime/agent-budget";
import { AgentError } from "@/lib/agent-runtime/agent-errors";

function expectBudgetExceeded(fn: () => void, dimension: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentError);
    const agentError = error as AgentError;
    expect(agentError.code).toBe("AGENT_BUDGET_EXHAUSTED");
    expect(agentError.retryable).toBe(false);
    expect(agentError.details).toMatchObject({ dimension });
    expect(agentError.message).toContain(dimension);
    return;
  }
  expect.unreachable(`expected AGENT_BUDGET_EXHAUSTED for ${dimension}`);
}

function createTracker(budget: AgentBudgetLimits, now: () => number = () => 0) {
  return new AgentBudgetTracker(budget, { now });
}

describe("agent budget constants (spec §11.4)", () => {
  it("pins the curriculum-builder budget to the spec numbers", () => {
    expect(CURRICULUM_AGENT_BUDGET).toEqual({
      maxAgentSteps: 40,
      maxSearchQueries: 10,
      maxFetchedPages: 20,
      maxRepairLoops: 2,
      maxSources: 30,
      maxRetriesPerStage: 2,
      maxOutputTokensPerCall: 8_000,
      maxTotalTokens: 400_000,
      maxRuntimeMsInline: 240_000,
      maxRuntimeMsQueued: 600_000,
    });
  });

  it("pins the tutor budget to the spec numbers", () => {
    expect(TUTOR_AGENT_BUDGET).toEqual({
      maxAgentSteps: 8,
      maxSourceSearches: 3,
      maxTotalTokens: 60_000,
      maxRuntimeMs: 90_000,
      maxOutputTokensPerCall: 6_000,
    });
  });
});

describe("AgentBudgetTracker", () => {
  it("allows consumption within the step budget and throws beyond it", () => {
    const tracker = createTracker({ maxAgentSteps: 2, maxTotalTokens: 1_000 });
    tracker.consumeStep();
    tracker.consumeStep();
    expectBudgetExceeded(() => tracker.consumeStep(), "maxAgentSteps");
  });

  it("enforces the search budget, including the tutor maxSourceSearches alias", () => {
    const curriculum = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000, maxSearchQueries: 1 });
    curriculum.consumeSearch();
    expectBudgetExceeded(() => curriculum.consumeSearch(), "maxSearchQueries");

    const tutor = createTracker(TUTOR_AGENT_BUDGET);
    tutor.consumeSearch();
    tutor.consumeSearch();
    tutor.consumeSearch();
    expectBudgetExceeded(() => tutor.consumeSearch(), "maxSearchQueries");
  });

  it("enforces fetch, repair and source budgets independently", () => {
    const fetches = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000, maxFetchedPages: 1 });
    fetches.consumeFetch();
    expectBudgetExceeded(() => fetches.consumeFetch(), "maxFetchedPages");

    const repairs = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000, maxRepairLoops: 2 });
    repairs.consumeRepair();
    repairs.consumeRepair();
    expectBudgetExceeded(() => repairs.consumeRepair(), "maxRepairLoops");

    const sources = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000, maxSources: 1 });
    sources.consumeSource();
    expectBudgetExceeded(() => sources.consumeSource(), "maxSources");
  });

  it("enforces the total token budget across prompt and completion tokens", () => {
    const tracker = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000 });
    tracker.consumeTokens(600);
    tracker.consumeOutputTokens(400);
    expectBudgetExceeded(() => tracker.consumeTokens(1), "maxTotalTokens");
  });

  it("enforces the per-call output token cap", () => {
    const tracker = createTracker({
      maxAgentSteps: 10,
      maxTotalTokens: 100_000,
      maxOutputTokensPerCall: 100,
    });
    tracker.consumeOutputTokens(100);
    expectBudgetExceeded(() => tracker.consumeOutputTokens(101), "maxOutputTokensPerCall");
  });

  it("checks runtime against the inline and queued limits with a fake clock", () => {
    let now = 1_000_000;
    const tracker = createTracker(
      {
        maxAgentSteps: 10,
        maxTotalTokens: 1_000,
        maxRuntimeMsInline: 240_000,
        maxRuntimeMsQueued: 600_000,
      },
      () => now,
    );

    now += 240_000;
    tracker.assertWithinRuntime("inline"); // exactly at the limit is allowed
    tracker.assertWithinRuntime("queued");

    now += 1;
    expectBudgetExceeded(() => tracker.assertWithinRuntime("inline"), "maxRuntimeMs");
    tracker.assertWithinRuntime("queued");

    now += 360_000;
    expectBudgetExceeded(() => tracker.assertWithinRuntime("queued"), "maxRuntimeMs");
  });

  it("applies the tutor's single maxRuntimeMs to both runtime modes", () => {
    let now = 0;
    const tracker = createTracker(TUTOR_AGENT_BUDGET, () => now);
    now += 90_000;
    tracker.assertWithinRuntime("inline");
    now += 1;
    expectBudgetExceeded(() => tracker.assertWithinRuntime("inline"), "maxRuntimeMs");
    expectBudgetExceeded(() => tracker.assertWithinRuntime("queued"), "maxRuntimeMs");
  });

  it("snapshots the current usage for agent_runs.usage_json", () => {
    let now = 500;
    const tracker = createTracker({ maxAgentSteps: 10, maxTotalTokens: 10_000 }, () => now);
    tracker.consumeStep();
    tracker.consumeSearch();
    tracker.consumeFetch();
    tracker.consumeRepair();
    tracker.consumeSource();
    tracker.consumeTokens(100);
    tracker.consumeOutputTokens(50);
    now += 42;

    expect(tracker.snapshot()).toEqual({
      agentSteps: 1,
      searchQueries: 1,
      fetchedPages: 1,
      repairLoops: 1,
      sources: 1,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      runtimeMs: 42,
    });
  });

  it("restores prior consumption so run-level caps survive a fresh tracker", () => {
    const tracker = createTracker({
      maxAgentSteps: 10,
      maxTotalTokens: 1_000,
      maxSearchQueries: 10,
      maxFetchedPages: 20,
    });
    tracker.restore({
      agentSteps: 4,
      searchQueries: 9,
      fetchedPages: 3,
      promptTokens: 576,
      totalTokens: 576,
    });

    expect(tracker.remainingSteps).toBe(6);
    expect(tracker.remainingSearches).toBe(1);
    expect(tracker.remainingFetches).toBe(17);
    expect(tracker.snapshot()).toMatchObject({
      agentSteps: 4,
      searchQueries: 9,
      fetchedPages: 3,
      promptTokens: 576,
      totalTokens: 576,
    });

    // The next consume on a nearly-exhausted dimension is what fails the run.
    tracker.consumeSearch();
    expectBudgetExceeded(() => tracker.consumeSearch(), "maxSearchQueries");
    expectBudgetExceeded(() => tracker.consumeTokens(500), "maxTotalTokens");
  });

  it("restores without throwing when prior consumption already reached a cap", () => {
    const tracker = createTracker({ maxAgentSteps: 3, maxTotalTokens: 100 });
    tracker.restore({ agentSteps: 3 });
    expect(tracker.remainingSteps).toBe(0);
    expectBudgetExceeded(() => tracker.consumeStep(), "maxAgentSteps");
  });

  it("restores absent dimensions as zero", () => {
    const tracker = createTracker({ maxAgentSteps: 10, maxTotalTokens: 1_000 });
    tracker.restore({});
    expect(tracker.snapshot()).toMatchObject({
      agentSteps: 0,
      searchQueries: 0,
      fetchedPages: 0,
      repairLoops: 0,
      sources: 0,
      totalTokens: 0,
    });
  });
});
