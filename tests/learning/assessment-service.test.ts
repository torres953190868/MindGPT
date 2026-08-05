import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCurriculumForOwner, createDraftVersionForOwner, publishVersionForOwner } from "@/lib/curriculum/curriculum-service";
import { getAssessmentRepository } from "@/lib/learning/assessment-repository";
import { submitAssessmentForOwner } from "@/lib/learning/assessment-service";
import { enrollLearnerForVersion, getLearningContextForOwner } from "@/lib/learning/learning-service";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

const AUTHOR = "assessment-author";
const LEARNER = "assessment-learner";
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-assessment-service-"));
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_LEARNING_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_CURRICULUM_DATA_DIR", dataDir);
  vi.stubEnv("BRANCHMIND_LEARNING_DATA_DIR", dataDir);
  vi.stubEnv("AI_MOCK_MODE", "true");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

async function setup() {
  const curriculum = await createCurriculumForOwner(AUTHOR, {
    title: "Assessment Course",
    subject: "Testing",
    learningGoal: "Learn assessment rules.",
  });
  const draft = await createDraftVersionForOwner(AUTHOR, curriculum.id, createValidCurriculumDraft());
  const version = await publishVersionForOwner(AUTHOR, curriculum.id, draft.version.id, true);
  const enrollment = await enrollLearnerForVersion(LEARNER, curriculum.id, version.id);
  const context = await getLearningContextForOwner(LEARNER, enrollment.id);
  const node = context.currentNode!;
  const exercise = await getAssessmentRepository().createExercise({
    curriculumVersionId: version.id,
    nodeId: node.clientId,
    exerciseType: "quiz",
    prompt: { question: "Explain the unit test." },
    rubric: { expectedKeywords: ["unit", "test"] },
  });
  return { enrollment, node, exercise };
}

describe("AssessmentService", () => {
  it("scores server-side, deduplicates identical answers, and completes after two independent assessments", async () => {
    const { enrollment, node, exercise } = await setup();
    const first = await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: node.clientId,
      exerciseId: exercise.id,
      answer: { text: "A unit test checks one behavior." },
    });
    const duplicate = await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: node.clientId,
      exerciseId: exercise.id,
      answer: { text: "A unit test checks one behavior." },
    });
    const second = await submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: node.clientId,
      exerciseId: exercise.id,
      answer: { text: "A unit test isolates and verifies one expected behavior." },
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.assessment.score).toBe(1);
    expect(second.progress.status).toBe("completed");
    expect(second.progress.masteryScore).toBe(1);
    expect(second.decision.evidence.criteriaPassed).toEqual(node.completionCriteria);
  });

  it("rejects a locked node before creating an assessment", async () => {
    const { enrollment } = await setup();
    await expect(submitAssessmentForOwner(LEARNER, {
      enrollmentId: enrollment.id,
      nodeId: "node-that-is-not-in-version",
      answer: { text: "forged" },
    })).rejects.toMatchObject({ code: "NODE_NOT_IN_ENROLLMENT" });
  });
});

