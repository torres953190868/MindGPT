import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelCallUsage } from "@/lib/agent-runtime/agent-usage";
import { getAgentMetricsForOwner, getAgentTraceForOwner } from "@/lib/agent-runtime/agent-observability";
import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";

describe("agent observability", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("aggregates owner-scoped metrics and redacts trace step bodies", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bm-agent-observability-"));
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      BRANCHMIND_CURRICULUM_BACKEND: "file",
      BRANCHMIND_AGENT_RUNS_DATA_DIR: directory,
    };
    const repository = getAgentRunRepository();
    const usage = {
      agentSteps: 1,
      searchQueries: 0,
      fetchedPages: 0,
      repairLoops: 0,
      sources: 0,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      runtimeMs: 12,
      estimatedCostUsd: 0.004,
      modelCalls: [createModelCallUsage({
        provider: "test",
        model: "model",
        promptTokens: 100,
        completionTokens: 50,
        rates: { "test/model": { inputPerMillionTokens: 20, outputPerMillionTokens: 8 } },
      })],
    };
    const created = await repository.createRun({
      agentType: "curriculum_builder",
      userId: "owner-a",
      idempotencyKey: "obs-1",
      input: { prompt: "do not expose" },
      budget: { maxAgentSteps: 4, maxTotalTokens: 10_000 },
    });
    if (created.kind !== "created") throw new Error("run was not created");
    const runId = created.run.id;
    await repository.startRun(runId);
    await repository.recordStep({
      runId,
      stepNumber: 1,
      stage: "planning",
      stepType: "model",
      input: { prompt: "secret prompt" },
      output: { answer: "secret answer" },
      status: "succeeded",
      durationMs: 12,
      usage: { prompt: "secret prompt", answer: "secret answer" },
    });
    await repository.appendEvent({ type: "stage_started", runId, seq: 1, stage: "planning" });
    await repository.finishRun(runId, { status: "failed", errorCode: "TEST_FAILURE", usage });

    const other = await repository.createRun({
      agentType: "curriculum_builder",
      userId: "owner-b",
      idempotencyKey: "obs-2",
      input: {},
      budget: { maxAgentSteps: 4, maxTotalTokens: 10_000 },
    });
    if (other.kind !== "created") throw new Error("second run was not created");
    await repository.finishRun(other.run.id, { status: "succeeded", usage });

    const metrics = await getAgentMetricsForOwner("owner-a");
    expect(metrics).toMatchObject({
      runCount: 1,
      statusCounts: { failed: 1, succeeded: 0 },
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.004,
      failureRate: 1,
      topErrorCodes: [{ code: "TEST_FAILURE", count: 1 }],
    });

    const trace = await getAgentTraceForOwner("owner-a", runId);
    expect(trace?.steps[0].usage).toMatchObject({
      prompt: { length: 13 },
      answer: { length: 13 },
    });
    expect(JSON.stringify(trace)).not.toContain("secret prompt");
    expect(JSON.stringify(trace)).not.toContain("secret answer");
    expect(trace?.events).toHaveLength(1);
    expect(await getAgentTraceForOwner("owner-b", runId)).toBeNull();
  });
});
