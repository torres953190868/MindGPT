// Tutor run recording: each tutor chat is wrapped in a lightweight agent run
// (one run row, one model step, usage persisted) so /api/agent-runs metrics
// and trace endpoints cover the tutor. Runs against the real file-backed
// repository with an isolated temporary data directory per test.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRICULUM_AGENT_BUDGET, TUTOR_AGENT_BUDGET } from "@/lib/agent-runtime/agent-budget";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { getAgentMetricsForOwner, getAgentTraceForOwner } from "@/lib/agent-runtime/agent-observability";
import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";
import { createRun, listRunSteps } from "@/lib/agent-runtime/agent-run-service";
import { MOCK_MODEL_USAGE } from "@/lib/agent-runtime/model-adapter";
import { createCurriculumForOwner, createDraftVersionForOwner, publishVersionForOwner } from "@/lib/curriculum/curriculum-service";
import { chatWithTutorForOwner, enrollLearnerForVersion } from "@/lib/learning/learning-service";
import { listDailyAiMessageUsage } from "@/lib/server/ai-usage";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

const AUTHOR = "curriculum-author";
const LEARNER = "learning-user";
const CHAT_MESSAGE = "Explain the unit test behavior.";
let dataDir: string;

const tutorAdapterControl = vi.hoisted(() => ({ failTutor: false }));

// Wraps the real adapter factory so one test can force the tutor's model call
// to fail. The tutor agent is the only caller whose scripted action carries a
// `lessonGoal` field; every other adapter is delegated unchanged.
vi.mock("@/lib/agent-runtime/model-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agent-runtime/model-adapter")>();
  return {
    ...original,
    createAgentModelAdapter: (options?: Parameters<typeof original.createAgentModelAdapter>[0]) => {
      const scriptedAction = options?.mockScript?.[0]?.action;
      if (
        tutorAdapterControl.failTutor &&
        scriptedAction !== null &&
        typeof scriptedAction === "object" &&
        "lessonGoal" in scriptedAction
      ) {
        return {
          completeAction: async () => {
            const { AgentError: LazyAgentError } = await import("@/lib/agent-runtime/agent-errors");
            throw new LazyAgentError("tutor model unavailable", {
              code: "AGENT_MODEL_CALL_FAILED",
              status: 502,
            });
          },
        };
      }
      return original.createAgentModelAdapter(options);
    },
  };
});

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-tutor-runs-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_LEARNING_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_AI_USAGE_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_AI_USAGE_DATA_DIR", dataDir);
  vi.stubEnv("AI_MOCK_MODE", "true");
});

afterEach(async () => {
  tutorAdapterControl.failTutor = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

async function publishedCourse() {
  const curriculum = await createCurriculumForOwner(AUTHOR, {
    title: "Testing Foundations",
    subject: "Testing",
    learningGoal: "Write reliable tests.",
  });
  const draft = await createDraftVersionForOwner(
    AUTHOR,
    curriculum.id,
    createValidCurriculumDraft(),
  );
  const published = await publishVersionForOwner(AUTHOR, curriculum.id, draft.version.id, true);
  return { curriculum, versionId: published.id };
}

describe("tutor run recording", () => {
  it("records a succeeded run with one model step and persisted usage", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);

    const result = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      message: CHAT_MESSAGE,
    });

    const runs = await getAgentRunRepository().listRunsForOwner(LEARNER, { agentType: "tutor" });
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.status).toBe("succeeded");
    expect(run.curriculumId).toBe(curriculum.id);
    expect(run.curriculumVersionId).toBe(versionId);
    expect(run.enrollmentId).toBe(enrollment.id);
    expect(run.idempotencyKey.startsWith("tutor-chat_")).toBe(true);
    expect(run.budget).toEqual(TUTOR_AGENT_BUDGET);
    expect(run.errorCode).toBeNull();
    expect(run.finishedAt).toBeTruthy();
    expect(run.usage?.agentSteps).toBe(1);
    expect(run.usage?.totalTokens).toBe(MOCK_MODEL_USAGE.totalTokens);
    expect(run.usage?.modelCalls).toHaveLength(1);

    // input_json is a privacy-safe summary: ids and counts, never message text.
    const input = run.input as Record<string, unknown>;
    expect(input.enrollmentId).toBe(enrollment.id);
    expect(input.nodeId).toBe(result.response.currentNodeId);
    expect(input.sessionId).toBe(result.session.id);
    expect(input.skillId).toBe("default");
    expect(input.messageLength).toBe(CHAT_MESSAGE.length);
    expect(JSON.stringify(run.input)).not.toContain("Explain the unit test");

    const steps = await listRunSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepNumber).toBe(1);
    expect(steps[0].stage).toBe("teaching");
    expect(steps[0].stepType).toBe("model");
    expect(steps[0].status).toBe("succeeded");
    const stepUsage = steps[0].usage as { provider?: string; totalTokens?: number } | null;
    expect(stepUsage?.provider).toBe("mock");
    expect(stepUsage?.totalTokens).toBe(MOCK_MODEL_USAGE.totalTokens);
    // Telemetry scrubbing: the step references messages and lesson markdown by
    // hash, never by content.
    expect(JSON.stringify(steps[0].input)).not.toContain("Explain the unit test");
    expect(JSON.stringify(steps[0].output)).not.toContain("本节聚焦");

    // The trace endpoint renders tutor runs with an empty event list.
    const trace = await getAgentTraceForOwner(LEARNER, run.id);
    expect(trace?.run.agentType).toBe("tutor");
    expect(trace?.steps).toHaveLength(1);
    expect(trace?.events).toEqual([]);

    // finishRun accounts the turn exactly once in the daily counters.
    const entries = await listDailyAiMessageUsage(LEARNER, "2000-01-01");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentRunsCount).toBe(1);
    expect(entries[0]?.agentTokensTotal).toBe(MOCK_MODEL_USAGE.totalTokens);
  });

  it("marks the run failed and rethrows the original error when the model call fails", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    tutorAdapterControl.failTutor = true;

    const error = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      message: CHAT_MESSAGE,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe("AGENT_MODEL_CALL_FAILED");
    expect((error as AgentError).status).toBe(502);

    const runs = await getAgentRunRepository().listRunsForOwner(LEARNER, { agentType: "tutor" });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorCode).toBe("AGENT_MODEL_CALL_FAILED");
    expect(runs[0].errorMessage).toContain("tutor model unavailable");
    expect(runs[0].finishedAt).toBeTruthy();

    const steps = await listRunSteps(runs[0].id);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("failed");
    // Step errors go through telemetry scrubbing (the "code" key is hashed,
    // same as curriculum-runner steps); the plain error code lives on the run.
    expect(steps[0].error).toBeTruthy();
  });

  it("serves the tutor response without a run record when the curriculum has an active run", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    // An in-flight curriculum generation holds the one active run slot.
    const builder = await createRun({
      agentType: "curriculum_builder",
      userId: AUTHOR,
      curriculumId: curriculum.id,
      idempotencyKey: "curriculum-generation-1",
      input: { learningGoal: "Write reliable tests." },
      budget: CURRICULUM_AGENT_BUDGET,
    });
    expect(builder.created).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      message: CHAT_MESSAGE,
    });

    expect(result.response.blocks.length).toBeGreaterThan(0);
    expect(result.response.currentNodeId).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(
      "BranchMind tutor run recording degraded",
      expect.objectContaining({ code: "AGENT_RUN_CONFLICT" }),
    );

    // No tutor run row was persisted; the conflicting run is untouched.
    const repository = getAgentRunRepository();
    expect(await repository.listRunsForOwner(LEARNER, { agentType: "tutor" })).toEqual([]);
    const builderRuns = await repository.listRunsForOwner(AUTHOR);
    expect(builderRuns).toHaveLength(1);
    expect(builderRuns[0].status).toBe("queued");

    // The degraded path keeps the standalone daily-usage accounting.
    const entries = await listDailyAiMessageUsage(LEARNER, "2000-01-01");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentRunsCount).toBe(1);
    expect(entries[0]?.agentTokensTotal).toBe(MOCK_MODEL_USAGE.totalTokens);
  });

  it("includes tutor usage in the owner agent metrics", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);

    await chatWithTutorForOwner(LEARNER, { enrollmentId: enrollment.id, message: CHAT_MESSAGE });

    const metrics = await getAgentMetricsForOwner(LEARNER);
    expect(metrics.runCount).toBe(1);
    expect(metrics.statusCounts.succeeded).toBe(1);
    expect(metrics.promptTokens).toBe(MOCK_MODEL_USAGE.promptTokens);
    expect(metrics.completionTokens).toBe(MOCK_MODEL_USAGE.completionTokens);
    expect(metrics.totalTokens).toBe(MOCK_MODEL_USAGE.totalTokens);
    expect(metrics.failureRate).toBe(0);

    const tutorOnly = await getAgentMetricsForOwner(LEARNER, { agentType: "tutor" });
    expect(tutorOnly.runCount).toBe(1);
    const builderOnly = await getAgentMetricsForOwner(LEARNER, { agentType: "curriculum_builder" });
    expect(builderOnly.runCount).toBe(0);
  });
});
