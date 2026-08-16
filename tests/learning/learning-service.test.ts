import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_MODEL_USAGE } from "@/lib/agent-runtime/model-adapter";
import { createCurriculumForOwner, createDraftVersionForOwner, publishVersionForOwner } from "@/lib/curriculum/curriculum-service";
import { getAssessmentRepository } from "@/lib/learning/assessment-repository";
import { getLearningRepository } from "@/lib/learning/learning-repository";
import { listDailyAiMessageUsage } from "@/lib/server/ai-usage";
import { chatWithTutorForOwner, enrollLearnerForVersion, getLearningContextForOwner, migrateEnrollmentForOwner } from "@/lib/learning/learning-service";
import { submitAssessmentForOwner } from "@/lib/learning/assessment-service";
import { appendTutorTurn } from "@/lib/learning/message-service";
import { saveSourceChunks } from "@/lib/research/source-chunk-service";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

const AUTHOR = "curriculum-author";
const LEARNER = "learning-user";
let dataDir: string;

const summaryAdapterControl = vi.hoisted(() => ({ failSummary: false }));

// Wraps the real adapter factory so a single test can force the session-summary
// model call to fail. The summary call is the only one whose scripted action
// carries a `summary` field; every other adapter (e.g. the Tutor agent) is
// delegated to the original implementation unchanged.
vi.mock("@/lib/agent-runtime/model-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agent-runtime/model-adapter")>();
  return {
    ...original,
    createAgentModelAdapter: (options?: Parameters<typeof original.createAgentModelAdapter>[0]) => {
      const scriptedAction = options?.mockScript?.[0]?.action;
      if (
        summaryAdapterControl.failSummary &&
        scriptedAction !== null &&
        typeof scriptedAction === "object" &&
        "summary" in scriptedAction
      ) {
        return {
          completeAction: () => Promise.reject(new Error("summary model unavailable")),
        };
      }
      return original.createAgentModelAdapter(options);
    },
  };
});

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-learning-service-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_LEARNING_DATA_DIR", dataDir);
  // Tutor chats now record agent runs; keep them in the isolated temp dir.
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
  // finishRun also folds turn usage into the daily AI-usage file.
  vi.stubEnv("BRANCHMIND_AI_USAGE_DATA_DIR", dataDir);
  vi.stubEnv("AI_MOCK_MODE", "true");
});

afterEach(async () => {
  summaryAdapterControl.failSummary = false;
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

describe("learning service", () => {
  it("enrolls a learner into a published version and is idempotent", async () => {
    const { curriculum, versionId } = await publishedCourse();

    const first = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const second = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);

    expect(second.id).toBe(first.id);
    expect(first.curriculumVersionId).toBe(versionId);
    expect(first.status).toBe("active");
  });

  it("keeps tutor retrieval and progress inside the enrolled version", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const version = await getLearningContextForOwner(LEARNER, enrollment.id);
    const sourceId = version.currentNode?.sourceIds[0];
    expect(sourceId).toBeTruthy();
    await saveSourceChunks({
      sourceId: sourceId!,
      content: "Arrange act assert is a useful structure for a unit test.",
    });

    const result = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      message: "Explain the unit test behavior.",
    });

    expect(result.response.currentNodeId).toBe(version.currentNode?.clientId);
    expect(result.response.progressProposal?.proposedStatus).toBe("in_progress");
    expect(result.sources[0]?.sourceId).toBe(sourceId);
    expect(result.progress.find((row) => row.nodeId === version.currentNode?.clientId)?.status).toBe("in_progress");
    expect((await getLearningRepository().listRecentMessages(LEARNER, enrollment.id, 10))).toHaveLength(3);
  });

  it("allows an existing enrollment to continue on a superseded version", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const oldEnrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const secondDraft = await createDraftVersionForOwner(AUTHOR, curriculum.id, createValidCurriculumDraft());
    const second = await publishVersionForOwner(AUTHOR, curriculum.id, secondDraft.version.id, true);
    const newEnrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, second.id);

    expect(newEnrollment.id).not.toBe(oldEnrollment.id);
    await expect(enrollLearnerForVersion("new-learner", curriculum.id, versionId)).rejects.toMatchObject({
      status: 409,
      code: "CURRICULUM_VERSION_NOT_CURRENTLY_PUBLISHED",
    });
    expect((await getLearningContextForOwner(LEARNER, oldEnrollment.id)).version.version.status).toBe("superseded");
    expect((await getLearningContextForOwner(LEARNER, newEnrollment.id)).version.version.status).toBe("published");
  });

  it("adapts the tutor response to the selected teaching skill", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const before = await getLearningContextForOwner(LEARNER, enrollment.id);
    const result = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      skillId: "socratic",
      message: "Help me think about it.",
    });

    expect(result.response.currentNodeId).toBe(before.currentNode?.clientId);
    const explanation = result.response.blocks.find((block) => block.type === "explanation");
    expect(explanation && "markdown" in explanation ? explanation.markdown : "").toContain("先回答一个问题");
  });

  it("registers Tutor-generated exercise ids and accepts the returned id", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const tutor = await chatWithTutorForOwner(LEARNER, { enrollmentId: enrollment.id });
    const exercise = tutor.response.blocks.find((block) => block.type === "exercise");
    expect(exercise?.type).toBe("exercise");
    if (exercise?.type !== "exercise") return;

    const submitted = await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: tutor.response.currentNodeId,
      exerciseId: exercise.exerciseId,
      answer: { text: "This is a concrete explanation with an example." },
    });
    const duplicate = await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: tutor.response.currentNodeId,
      exerciseId: exercise.exerciseId,
      answer: { text: "This is a concrete explanation with an example." },
    });

    expect(submitted.created).toBe(true);
    expect(submitted.assessment.id).toBe(exercise.exerciseId);
    expect(duplicate.created).toBe(false);
  });

  it("allows a requested eligible node and explains locked prerequisites", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const initial = await getLearningContextForOwner(LEARNER, enrollment.id);
    const nodes = initial.version.draft.modules.flatMap((module) => module.nodes);
    const firstNodeId = nodes[0].clientId;
    const secondNodeId = nodes[1].clientId;

    const locked = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      targetNodeId: secondNodeId,
    });
    expect(locked.response.currentNodeId).toBe(secondNodeId);
    expect(locked.response.blocks[0]?.type).toBe("prerequisite_gap");
    expect(locked.response.progressProposal).toBeUndefined();
    expect(locked.progress.find((row) => row.nodeId === secondNodeId)).toBeUndefined();

    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, firstNodeId, {
      status: "completed",
      masteryScore: 1,
    });
    const allowed = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      targetNodeId: secondNodeId,
    });
    expect(allowed.response.currentNodeId).toBe(secondNodeId);
    expect(allowed.response.progressProposal?.nodeId).toBe(secondNodeId);
  });

  it("refreshes a session summary after the message threshold", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const repository = getLearningRepository();
    const session = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: "n1" });
    if (!session) throw new Error("session was not created");
    await repository.appendMessages(
      LEARNER,
      enrollment.id,
      session.id,
      Array.from({ length: 20 }, (_, index) => ({
        role: "user" as const,
        blocks: [{ type: "text", text: `学习记录 ${index}` }],
      })),
    );

    await appendTutorTurn(
      LEARNER,
      enrollment.id,
      session.id,
      {
        userMessage: "继续",
        response: {
          lessonGoal: "复习",
          currentNodeId: "n1",
          blocks: [{ type: "explanation", markdown: "继续复习当前节点。" }],
        },
        session,
      },
      repository,
    );

    const refreshed = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: "n1" });
    expect(refreshed?.summary).toBeTruthy();
  });

  it("previews and confirms an enrollment version migration without rewriting old progress", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const oldContext = await getLearningContextForOwner(LEARNER, enrollment.id);
    const oldNodes = oldContext.version.draft.modules.flatMap((courseModule) => courseModule.nodes);
    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, oldNodes[0].clientId, {
      status: "completed",
      masteryScore: 0.8,
      lastEvidence: { old: true },
    });
    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, oldNodes[1].clientId, {
      status: "in_progress",
      masteryScore: 0.4,
    });

    const targetDraft = createValidCurriculumDraft();
    targetDraft.modules[0].nodes[0].title = oldNodes[0].title;
    targetDraft.modules[0].nodes[1].title = "Renamed node for position fallback";
    const target = await createDraftVersionForOwner(AUTHOR, curriculum.id, targetDraft);
    const publishedTarget = await publishVersionForOwner(AUTHOR, curriculum.id, target.version.id, true);

    const preview = await migrateEnrollmentForOwner(
      LEARNER,
      curriculum.id,
      enrollment.id,
      { targetVersionId: publishedTarget.id, confirmation: false },
    );
    expect(preview.migrated).toBe(false);
    expect(preview.path).toBeNull();
    expect(preview.preview.mappings.some((mapping) => mapping.confidence === "title")).toBe(true);
    expect(preview.preview.mappings.some((mapping) => mapping.confidence === "position")).toBe(true);
    expect((await getLearningContextForOwner(LEARNER, enrollment.id)).enrollment.curriculumVersionId).toBe(versionId);

    const migrated = await migrateEnrollmentForOwner(
      LEARNER,
      curriculum.id,
      enrollment.id,
      { targetVersionId: publishedTarget.id, confirmation: true },
    );
    expect(migrated.migrated).toBe(true);
    expect(migrated.enrollment.curriculumVersionId).toBe(publishedTarget.id);
    const migratedProgress = await getLearningRepository().listProgress(LEARNER, enrollment.id);
    expect(migratedProgress.some((row) => row.lastEvidence && JSON.stringify(row.lastEvidence).includes("MIGRATED_FROM_VERSION"))).toBe(true);
    await expect(
      migrateEnrollmentForOwner("other-user", curriculum.id, enrollment.id, {
        targetVersionId: publishedTarget.id,
        confirmation: false,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("marks nodes that match neither title nor position as unmatched in the migration preview", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const oldContext = await getLearningContextForOwner(LEARNER, enrollment.id);
    const oldNodes = oldContext.version.draft.modules.flatMap((courseModule) => courseModule.nodes);

    const targetDraft = createValidCurriculumDraft();
    targetDraft.modules[0].nodes[1].title = "Brand New Topic Without A Match";
    targetDraft.modules[0].nodes[1].orderIndex = 5;
    const target = await createDraftVersionForOwner(AUTHOR, curriculum.id, targetDraft);
    const publishedTarget = await publishVersionForOwner(AUTHOR, curriculum.id, target.version.id, true);

    const preview = await migrateEnrollmentForOwner(
      LEARNER,
      curriculum.id,
      enrollment.id,
      { targetVersionId: publishedTarget.id, confirmation: false },
    );

    expect(preview.migrated).toBe(false);
    const unmatched = preview.preview.mappings.find((mapping) => mapping.confidence === "unmatched");
    expect(unmatched?.fromNodeId).toBe(oldNodes[1].clientId);
    expect(unmatched?.toNodeId).toBeNull();
    expect(unmatched?.toTitle).toBeNull();
    expect(preview.preview.mappings.some((mapping) => mapping.confidence === "title")).toBe(true);
  });

  it("leaves previous-version progress rows and assessments untouched after migration", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const oldContext = await getLearningContextForOwner(LEARNER, enrollment.id);
    const oldNodes = oldContext.version.draft.modules.flatMap((courseModule) => courseModule.nodes);
    const firstNodeId = oldNodes[0].clientId;
    const secondNodeId = oldNodes[1].clientId;

    await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: firstNodeId,
      answer: { text: "Unit tests check one unit in isolation with examples." },
    });
    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, firstNodeId, {
      status: "completed",
      masteryScore: 0.8,
      lastEvidence: { old: true },
    });
    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, secondNodeId, {
      status: "in_progress",
      masteryScore: 0.4,
    });
    const progressBefore = await getLearningRepository().listProgress(LEARNER, enrollment.id);
    const assessmentsBefore = await getAssessmentRepository().listAssessments(LEARNER, enrollment.id, firstNodeId);
    expect(progressBefore.length).toBeGreaterThan(0);
    expect(assessmentsBefore.length).toBeGreaterThan(0);

    // Same titles but freshly generated node ids at persistence, so mappings
    // resolve by title and the old progress rows (keyed by the previous
    // clientIds) cannot be rewritten in place.
    const target = await createDraftVersionForOwner(AUTHOR, curriculum.id, createValidCurriculumDraft());
    const publishedTarget = await publishVersionForOwner(AUTHOR, curriculum.id, target.version.id, true);

    const migrated = await migrateEnrollmentForOwner(
      LEARNER,
      curriculum.id,
      enrollment.id,
      { targetVersionId: publishedTarget.id, confirmation: true },
    );
    expect(migrated.migrated).toBe(true);

    const progressAfter = await getLearningRepository().listProgress(LEARNER, enrollment.id);
    for (const previousRow of progressBefore) {
      expect(progressAfter).toContainEqual(previousRow);
    }
    expect(await getAssessmentRepository().listAssessments(LEARNER, enrollment.id, firstNodeId)).toEqual(assessmentsBefore);
    const carriedMappings = migrated.preview.mappings.filter((mapping) => mapping.previousProgress);
    expect(carriedMappings.length).toBeGreaterThan(0);
    for (const mapping of carriedMappings) {
      expect(mapping.toNodeId).not.toBe(mapping.fromNodeId);
      expect(progressAfter.some((row) => row.nodeId === mapping.toNodeId)).toBe(true);
    }
  });

  it("rejects migration to a target version that is not published", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const draft = await createDraftVersionForOwner(AUTHOR, curriculum.id, createValidCurriculumDraft());

    await expect(
      migrateEnrollmentForOwner(LEARNER, curriculum.id, enrollment.id, {
        targetVersionId: draft.version.id,
        confirmation: true,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CURRICULUM_VERSION_NOT_PUBLISHED" });
  });

  it("returns an idempotent no-op when migrating to the currently enrolled version", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    await getLearningRepository().upsertProgress(LEARNER, enrollment.id, "n1", {
      status: "in_progress",
      masteryScore: 0.4,
    });
    const progressBefore = await getLearningRepository().listProgress(LEARNER, enrollment.id);
    const enrollmentBefore = (await getLearningContextForOwner(LEARNER, enrollment.id)).enrollment;

    const result = await migrateEnrollmentForOwner(
      LEARNER,
      curriculum.id,
      enrollment.id,
      { targetVersionId: versionId, confirmation: true },
    );

    expect(result.migrated).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(result.enrollment.curriculumVersionId).toBe(versionId);
    expect(await getLearningRepository().listProgress(LEARNER, enrollment.id)).toEqual(progressBefore);
    expect((await getLearningContextForOwner(LEARNER, enrollment.id)).enrollment.updatedAt).toBe(enrollmentBefore.updatedAt);
  });

  it("updates an existing session summary when the refresh threshold is crossed again", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const repository = getLearningRepository();
    const session = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: "n1" });
    if (!session) throw new Error("session was not created");
    const seeded = await repository.updateSessionSummary(LEARNER, enrollment.id, session.id, "旧摘要：已掌握测试词汇。");
    if (!seeded) throw new Error("session summary was not stored");
    await repository.appendMessages(
      LEARNER,
      enrollment.id,
      session.id,
      Array.from({ length: 20 }, (_, index) => ({
        role: "user" as const,
        blocks: [{ type: "text", text: `学习记录 ${index}` }],
      })),
    );

    await appendTutorTurn(
      LEARNER,
      enrollment.id,
      session.id,
      {
        userMessage: "继续",
        response: {
          lessonGoal: "复习",
          currentNodeId: "n1",
          blocks: [{ type: "explanation", markdown: "继续复习当前节点。" }],
        },
        session: seeded,
      },
      repository,
    );

    const refreshed = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: "n1" });
    expect(seeded.summary).toBe("旧摘要：已掌握测试词汇。");
    expect(refreshed?.summary).toBeTruthy();
    expect(refreshed?.summary).not.toBe(seeded.summary);
    expect(refreshed?.summary).toContain("学习记录");
  });

  it("keeps the tutor response and the previous summary when the summary model call fails", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const repository = getLearningRepository();
    const currentNodeId = (await getLearningContextForOwner(LEARNER, enrollment.id)).path.currentNodeId;
    if (!currentNodeId) throw new Error("no current learning node");
    const session = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: currentNodeId });
    if (!session) throw new Error("session was not created");
    const previousSummary = "旧摘要：学习者已掌握测试词汇。";
    await repository.updateSessionSummary(LEARNER, enrollment.id, session.id, previousSummary);
    await repository.appendMessages(
      LEARNER,
      enrollment.id,
      session.id,
      Array.from({ length: 20 }, (_, index) => ({
        role: "user" as const,
        blocks: [{ type: "text", text: `学习记录 ${index}` }],
      })),
    );

    summaryAdapterControl.failSummary = true;
    const result = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      message: "继续",
    });

    expect(result.response.blocks.some((block) => block.type === "explanation")).toBe(true);
    expect(result.session.summary).toBe(previousSummary);
    const persisted = await repository.getOrCreateSession(LEARNER, enrollment.id, { nodeId: currentNodeId });
    expect(persisted?.summary).toBe(previousSummary);
    expect((await repository.listRecentMessages(LEARNER, enrollment.id, 50)).length).toBeGreaterThan(20);
  });

  it("returns 404 when the requested target node does not exist in the enrolled version", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);

    await expect(
      chatWithTutorForOwner(LEARNER, {
        enrollmentId: enrollment.id,
        targetNodeId: "node-that-does-not-exist",
      }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("lists every incomplete transitive prerequisite when the requested node is locked", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    const initial = await getLearningContextForOwner(LEARNER, enrollment.id);
    const nodes = initial.version.draft.modules.flatMap((courseModule) => courseModule.nodes);
    const firstNodeId = nodes[0].clientId;
    const secondNodeId = nodes[1].clientId;
    const thirdNodeId = nodes[2].clientId;

    const locked = await chatWithTutorForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      targetNodeId: thirdNodeId,
    });

    expect(locked.response.currentNodeId).toBe(thirdNodeId);
    const gap = locked.response.blocks[0];
    expect(gap?.type).toBe("prerequisite_gap");
    if (gap?.type !== "prerequisite_gap") return;
    expect(gap.missingNodeIds).toHaveLength(2);
    expect(gap.missingNodeIds).toEqual(expect.arrayContaining([firstNodeId, secondNodeId]));
  });

  it("drops tutor question and exercise blocks when exercise registration fails", async () => {
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);
    vi.spyOn(getAssessmentRepository(), "registerGeneratedExercise").mockRejectedValue(
      new Error("assessment store unavailable"),
    );

    const tutor = await chatWithTutorForOwner(LEARNER, { enrollmentId: enrollment.id });

    expect(tutor.response.blocks.some((block) => block.type === "question" || block.type === "exercise")).toBe(false);
    expect(JSON.stringify(tutor.response.blocks)).not.toContain("generated-exercise-");
    expect(tutor.response.blocks.some((block) => block.type === "explanation")).toBe(true);
  });

  it("adds tutor agent token usage to the daily agent usage total", async () => {
    vi.stubEnv("BRANCHMIND_AI_USAGE_BACKEND", "file");
    vi.stubEnv("BRANCHMIND_AI_USAGE_DATA_DIR", dataDir);
    const { curriculum, versionId } = await publishedCourse();
    const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, versionId);

    await chatWithTutorForOwner(LEARNER, { enrollmentId: enrollment.id });

    const entries = await listDailyAiMessageUsage(LEARNER, "2000-01-01");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentRunsCount).toBe(1);
    expect(entries[0]?.agentTokensTotal).toBe(MOCK_MODEL_USAGE.totalTokens);
  });

  it("rejects enrolling and chatting on a draft curriculum version", async () => {
    const curriculum = await createCurriculumForOwner(AUTHOR, {
      title: "Testing Foundations",
      subject: "Testing",
      learningGoal: "Write reliable tests.",
    });
    const draft = await createDraftVersionForOwner(AUTHOR, curriculum.id, createValidCurriculumDraft());

    await expect(enrollLearnerForVersion(LEARNER, curriculum.id, draft.version.id)).rejects.toMatchObject({
      status: 409,
      code: "CURRICULUM_VERSION_NOT_PUBLISHED",
    });

    // The repository does not validate version status, so binding an
    // enrollment to a draft directly exercises the chat-path guard too.
    const directEnrollment = await getLearningRepository().createEnrollment(LEARNER, {
      curriculumId: curriculum.id,
      curriculumVersionId: draft.version.id,
    });
    await expect(
      chatWithTutorForOwner(LEARNER, { enrollmentId: directEnrollment.id }),
    ).rejects.toMatchObject({ status: 409, code: "CURRICULUM_VERSION_NOT_PUBLISHED" });
  });
});
