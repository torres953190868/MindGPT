// Service-layer tests for the agent runtime, running against the real
// file-backed repository (BRANCHMIND_CURRICULUM_BACKEND=file) with an
// isolated temporary data directory per test. Never touches Supabase.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRICULUM_AGENT_BUDGET, TUTOR_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";
import type { CreateAgentRunRecord } from "@/lib/agent-runtime/agent-run-repository";
import {
  appendEvent,
  cancelRun,
  checkpointStage,
  completeStep,
  countRunsByUserAndTypeSince,
  createRun,
  finishRun,
  getEventsAfter,
  getRun,
  isRunCancelled,
  resumeRun,
  startRun,
} from "@/lib/agent-runtime/agent-run-service";
import { AgentEventSequencer } from "@/lib/agent-runtime/stream-events";
import { listDailyAiMessageUsage } from "@/lib/server/ai-usage";

const OWNER = "user_agent_runs";
const OTHER_OWNER = "user_someone_else";

let dataDir: string;
let keyCounter = 0;

function createInput(overrides: Partial<CreateAgentRunRecord> = {}): CreateAgentRunRecord {
  keyCounter += 1;
  return {
    agentType: "curriculum_builder",
    userId: OWNER,
    curriculumId: "curriculum_ml",
    input: { learningGoal: "Learn ML" },
    idempotencyKey: `key-${keyCounter}`,
    budget: CURRICULUM_AGENT_BUDGET,
    ...overrides,
  };
}

async function expectAgentError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AgentError);
  expect((error as AgentError).code).toBe(code);
  expect((error as AgentError).status).toBe(status);
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-agent-runs-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

describe("createRun", () => {
  it("creates a queued run and deduplicates on the idempotency key", async () => {
    const input = createInput({ projectId: "project_1" });
    const first = await createRun(input);
    expect(first.created).toBe(true);
    expect(first.run.id).toMatch(/^run_/);
    expect(first.run.status).toBe("queued");
    expect(first.run.userId).toBe(OWNER);
    expect(first.run.budget).toEqual(CURRICULUM_AGENT_BUDGET);
    expect(first.run.startedAt).toBeTruthy();

    // A client retry with the same key replays the existing run instead of
    // creating a duplicate (spec §11.5).
    const replay = await createRun(input);
    expect(replay.created).toBe(false);
    expect(replay.run.id).toBe(first.run.id);
  });

  it("rejects a second active run for the same curriculum with a 409", async () => {
    await createRun(createInput());
    await expectAgentError(createRun(createInput()), "AGENT_RUN_CONFLICT", 409);

    // Runs without a curriculum are unconstrained.
    const tutorRun = await createRun(
      createInput({
        agentType: "tutor",
        curriculumId: null,
        budget: TUTOR_AGENT_BUDGET,
      }),
    );
    expect(tutorRun.created).toBe(true);
  });

  it("allows a new run once the previous one reached a terminal status", async () => {
    const first = await createRun(createInput());
    await finishRun(first.run.id, { status: "failed", errorMessage: "boom" });

    const second = await createRun(createInput());
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
  });
});

describe("steps and checkpoints", () => {
  it("persists completed steps and advances the stage pointer", async () => {
    const { run } = await createRun(createInput());
    await startRun(run.id);

    const step = await completeStep({
      runId: run.id,
      stepNumber: 1,
      stage: "planning",
      stepType: "model",
      input: { prompt: "plan" },
      output: { queries: ["ml basics"] },
      status: "succeeded",
      durationMs: 120,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    expect(step.id).toMatch(/^step_/);
    expect(step.status).toBe("succeeded");

    const steps = await getAgentRunRepository().listSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stepNumber: 1, stage: "planning", stepType: "model" });

    const fetched = await getRun(OWNER, run.id);
    expect(fetched.currentStage).toBe("planning");
  });

  it("rejects a duplicate step number with a 409", async () => {
    const { run } = await createRun(createInput());
    const step = {
      runId: run.id,
      stepNumber: 1,
      stage: "intake",
      stepType: "model" as const,
      input: {},
      status: "succeeded" as const,
      durationMs: 1,
    };
    await completeStep(step);
    await expectAgentError(completeStep(step), "AGENT_RUN_CONFLICT", 409);
  });

  it("checkpoints stage artifacts into output_json and resume_from_stage", async () => {
    const { run } = await createRun(createInput());
    const artifacts = { queries: ["a", "b"], plan: { modules: 3 } };

    const checkpointed = await checkpointStage(run.id, "searching", artifacts);
    expect(checkpointed.resumeFromStage).toBe("searching");
    expect(checkpointed.output?.checkpoints.searching.artifacts).toEqual(artifacts);

    // A later checkpoint keeps the earlier one (merge, not replace).
    const later = await checkpointStage(run.id, "building_graph", { nodes: 12 });
    expect(later.resumeFromStage).toBe("building_graph");
    expect(Object.keys(later.output?.checkpoints ?? {}).sort()).toEqual([
      "building_graph",
      "searching",
    ]);
  });

  it("finishRun stores output, usage and error details; terminal re-finish conflicts", async () => {
    const { run } = await createRun(createInput());
    const usage = {
      agentSteps: 3,
      searchQueries: 2,
      fetchedPages: 4,
      repairLoops: 0,
      sources: 5,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      runtimeMs: 1_000,
    };
    const finished = await finishRun(run.id, {
      status: "succeeded",
      output: { curriculumVersionId: "cver_1" },
      usage,
    });
    expect(finished.status).toBe("succeeded");
    expect(finished.finishedAt).toBeTruthy();
    expect(finished.usage).toEqual(usage);
    expect(finished.output?.result).toEqual({ curriculumVersionId: "cver_1" });

    await expectAgentError(
      finishRun(run.id, { status: "failed" }),
      "AGENT_RUN_CONFLICT",
      409,
    );
    // Re-finishing with the SAME terminal status is an idempotent replay.
    const replayed = await finishRun(run.id, { status: "succeeded" });
    expect(replayed.id).toBe(run.id);
  });
});

describe("events (spec §8.11)", () => {
  it("persists events and replays them after a cursor without duplicates", async () => {
    const { run } = await createRun(createInput());
    const sequencer = new AgentEventSequencer(run.id);

    await appendEvent(run.id, sequencer.next({ type: "run_started" }));
    await appendEvent(run.id, sequencer.next({ type: "stage_started", stage: "intake" }));
    await appendEvent(run.id, sequencer.next({ type: "search_started", query: "ml" }));

    const all = await getEventsAfter(OWNER, run.id, 0);
    expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(all[0].event).toMatchObject({ type: "run_started", runId: run.id, seq: 1 });

    const afterOne = await getEventsAfter(OWNER, run.id, 1);
    expect(afterOne.map((entry) => entry.seq)).toEqual([2, 3]);

    const afterThree = await getEventsAfter(OWNER, run.id, 3);
    expect(afterThree).toEqual([]);
  });

  it("scopes run status and events to the owner", async () => {
    const { run } = await createRun(createInput());
    const sequencer = new AgentEventSequencer(run.id);
    await appendEvent(run.id, sequencer.next({ type: "run_started" }));

    await expectAgentError(getRun(OTHER_OWNER, run.id), "AGENT_RUN_NOT_FOUND", 404);
    await expectAgentError(
      getEventsAfter(OTHER_OWNER, run.id, 0),
      "AGENT_RUN_NOT_FOUND",
      404,
    );
  });
});

describe("cancel (spec §8.12)", () => {
  it("cancels a non-terminal run and rejects cancelling a terminal run", async () => {
    const { run } = await createRun(createInput());
    expect(await isRunCancelled(run.id)).toBe(false);

    const cancelled = await cancelRun(OWNER, run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).toBeTruthy();
    expect(await isRunCancelled(run.id)).toBe(true);

    // Any terminal status is a 409 on cancel.
    await expectAgentError(cancelRun(OWNER, run.id), "AGENT_RUN_CONFLICT", 409);
  });

  it("returns 404 when cancelling a run owned by someone else", async () => {
    const { run } = await createRun(createInput());
    await expectAgentError(cancelRun(OTHER_OWNER, run.id), "AGENT_RUN_NOT_FOUND", 404);
  });
});

describe("resume (spec §8.12)", () => {
  it("only allows failed or cancelled runs to resume", async () => {
    const queued = await createRun(createInput());
    await expectAgentError(
      resumeRun(OWNER, queued.run.id, "resume-key-1"),
      "AGENT_RESUME_NOT_ALLOWED",
      409,
    );

    const succeeded = await createRun(createInput({ curriculumId: "curriculum_other" }));
    await finishRun(succeeded.run.id, { status: "succeeded" });
    await expectAgentError(
      resumeRun(OWNER, succeeded.run.id, "resume-key-2"),
      "AGENT_RESUME_NOT_ALLOWED",
      409,
    );
  });

  it("resumes a failed run into queued with checkpoints and a fresh key", async () => {
    const { run } = await createRun(createInput());
    await startRun(run.id);
    await completeStep({
      runId: run.id,
      stepNumber: 1,
      stage: "searching",
      stepType: "tool",
      toolName: "web_search",
      input: { query: "ml" },
      status: "succeeded",
      durationMs: 50,
    });
    await checkpointStage(run.id, "searching", { queries: ["ml"], results: 8 });
    await finishRun(run.id, {
      status: "failed",
      errorCode: "AGENT_STAGE_FAILED",
      errorMessage: "fetching_sources blew up",
    });

    const resumed = await resumeRun(OWNER, run.id, "resume-key-3");
    expect(resumed.run.status).toBe("queued");
    expect(resumed.run.idempotencyKey).toBe("resume-key-3");
    expect(resumed.run.errorCode).toBeNull();
    expect(resumed.run.errorMessage).toBeNull();
    expect(resumed.run.finishedAt).toBeNull();
    expect(resumed.resumeFromStage).toBe("searching");
    expect(resumed.checkpoints.searching.artifacts).toEqual({ queries: ["ml"], results: 8 });

    // Step history survives the resume (diagnostics, spec §3.8).
    expect(await getAgentRunRepository().listSteps(run.id)).toHaveLength(1);

    // A retried resume with the same key replays the already-resumed run.
    const replay = await resumeRun(OWNER, run.id, "resume-key-3");
    expect(replay.run.status).toBe("queued");
  });

  it("resumes a cancelled run", async () => {
    const { run } = await createRun(createInput());
    await cancelRun(OWNER, run.id);

    const resumed = await resumeRun(OWNER, run.id, "resume-key-4");
    expect(resumed.run.status).toBe("queued");
    expect(resumed.resumeFromStage).toBeNull();
    expect(resumed.checkpoints).toEqual({});
  });

  it("conflicts when another active run exists for the curriculum", async () => {
    const first = await createRun(createInput());
    await cancelRun(OWNER, first.run.id);
    await createRun(createInput()); // new active run for the same curriculum

    await expectAgentError(
      resumeRun(OWNER, first.run.id, "resume-key-5"),
      "AGENT_RUN_CONFLICT",
      409,
    );
  });
});

describe("quota accounting", () => {
  it("counts runs per user and type since a timestamp", async () => {
    await createRun(createInput());
    await createRun(createInput({ curriculumId: "curriculum_physics" }));
    await createRun(
      createInput({ agentType: "tutor", curriculumId: null, budget: TUTOR_AGENT_BUDGET }),
    );
    await createRun(createInput({ userId: OTHER_OWNER, curriculumId: "curriculum_chem" }));

    expect(
      await countRunsByUserAndTypeSince(OWNER, "curriculum_builder", "1970-01-01T00:00:00Z"),
    ).toBe(2);
    expect(await countRunsByUserAndTypeSince(OWNER, "tutor", "1970-01-01T00:00:00Z")).toBe(1);
    expect(
      await countRunsByUserAndTypeSince(OWNER, "curriculum_builder", "2999-01-01T00:00:00Z"),
    ).toBe(0);
  });
});

describe("daily usage accounting", () => {
  it("aggregates terminal-run token usage into the daily agent usage store", async () => {
    vi.stubEnv("BRANCHMIND_AI_USAGE_BACKEND", "file");
    vi.stubEnv("BRANCHMIND_AI_USAGE_DATA_DIR", dataDir);
    const today = new Date().toISOString().slice(0, 10);

    const { run: succeededRun } = await createRun(createInput());
    await finishRun(succeededRun.id, {
      status: "succeeded",
      usage: {
        agentSteps: 3,
        searchQueries: 2,
        fetchedPages: 4,
        repairLoops: 0,
        sources: 5,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        runtimeMs: 1_000,
      },
    });
    // An idempotent re-finish with the same terminal status must not
    // double-count usage.
    await finishRun(succeededRun.id, { status: "succeeded" });

    const { run: failedRun } = await createRun(
      createInput({ curriculumId: "curriculum_physics" }),
    );
    await finishRun(failedRun.id, {
      status: "failed",
      errorMessage: "boom",
      usage: {
        agentSteps: 1,
        searchQueries: 0,
        fetchedPages: 0,
        repairLoops: 0,
        sources: 0,
        promptTokens: 30,
        completionTokens: 10,
        totalTokens: 40,
        runtimeMs: 200,
      },
    });

    await expect(listDailyAiMessageUsage(OWNER, today)).resolves.toEqual([
      { date: today, messageCount: 0, agentTokensTotal: 190, agentRunsCount: 2 },
    ]);
  });
});
