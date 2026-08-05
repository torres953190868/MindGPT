import { createHash } from "node:crypto";
import { HttpError } from "@/lib/server/http";
import { flattenLearningNodes } from "@/lib/learning/learning-path-service";
import {
  getAssessmentRepository,
  type AssessmentRepository,
} from "@/lib/learning/assessment-repository";
import { getLearningRepository, type LearningRepository } from "@/lib/learning/learning-repository";
import { getLearningContextForOwner } from "@/lib/learning/learning-service";
import { ProgressService } from "@/lib/learning/progress-service";
import type {
  CurriculumExercise,
  LearningAssessment,
  LearningAssessmentType,
  LearningNodeProgress,
} from "@/lib/learning/learning-types";

export type SubmitAssessmentInput = {
  enrollmentId: string;
  nodeId: string;
  exerciseId?: string | null;
  answer: unknown;
};

export type SubmitAssessmentResult = {
  assessment: Awaited<ReturnType<AssessmentRepository["createAssessment"]>>["assessment"];
  created: boolean;
  progress: LearningNodeProgress;
  decision: Awaited<ReturnType<ProgressService["recomputeNode"]>>["decision"];
};

export async function registerGeneratedExercise(input: {
  userId: string;
  sessionId: string;
  enrollmentId: string;
  nodeId: string;
  prompt: unknown;
  rubric?: unknown;
  assessmentRepository?: AssessmentRepository;
}): Promise<LearningAssessment> {
  return (input.assessmentRepository ?? getAssessmentRepository()).registerGeneratedExercise({
    userId: input.userId,
    sessionId: input.sessionId,
    enrollmentId: input.enrollmentId,
    nodeId: input.nodeId,
    prompt: input.prompt,
    rubric: input.rubric ?? { expectedKeywords: [] },
  });
}

function reject(message: string, code: string, status = 400): never {
  throw new HttpError(message, { code, expose: true, status });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function hashAssessmentAnswer(answer: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(answer))).digest("hex");
}

function answerText(answer: unknown): string {
  if (typeof answer === "string") return answer.trim();
  if (answer && typeof answer === "object") {
    const record = answer as Record<string, unknown>;
    const preferred = [record.text, record.answer, record.code, record.explanation]
      .find((value) => typeof value === "string");
    if (typeof preferred === "string") return preferred.trim();
  }
  return JSON.stringify(answer ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scoreAnswer(answer: unknown, rubric: unknown, completionCriteria: string[]) {
  const text = answerText(answer).toLowerCase();
  if (!text) {
    return {
      score: 0,
      criteriaPassed: [] as string[],
      reason: "答案为空，未产生可审查的通过证据。",
    };
  }

  const rubricRecord = asRecord(rubric);
  const expectedKeywords = Array.isArray(rubricRecord.expectedKeywords)
    ? rubricRecord.expectedKeywords.filter((entry): entry is string => typeof entry === "string")
    : [];
  const covered = expectedKeywords.filter((keyword) => text.includes(keyword.toLowerCase()));
  const score = expectedKeywords.length === 0
    ? (text.length >= 12 ? 0.9 : 0.65)
    : Math.max(0, Math.min(1, covered.length / expectedKeywords.length));
  const criteriaPassed = score >= 0.8 ? completionCriteria : [];
  return {
    score,
    criteriaPassed,
    reason: expectedKeywords.length === 0
      ? "答案长度和非空内容通过了 Phase 5 的确定性 MVP 评分规则。"
      : `覆盖 ${covered.length}/${expectedKeywords.length} 个服务端 rubric 关键词。`,
  };
}

function toAssessmentType(exercise: CurriculumExercise | null): LearningAssessmentType {
  return exercise?.exerciseType ?? "exercise";
}

export async function submitAssessmentForOwner(
  userId: string,
  input: SubmitAssessmentInput,
  options: { learningRepository?: LearningRepository; assessmentRepository?: AssessmentRepository } = {},
): Promise<SubmitAssessmentResult> {
  const learningRepository = options.learningRepository ?? getLearningRepository();
  const assessmentRepository = options.assessmentRepository ?? getAssessmentRepository();
  const context = await getLearningContextForOwner(userId, input.enrollmentId, {
    repository: learningRepository,
  });
  const node = flattenLearningNodes(context.version.draft).find((entry) => entry.clientId === input.nodeId);
  if (!node) reject("The node is not part of the enrolled curriculum version.", "NODE_NOT_IN_ENROLLMENT", 404);
  const pathNode = context.path.nodes.find((entry) => entry.nodeId === input.nodeId);
  if (!pathNode || pathNode.status === "locked") {
    reject("This node is locked until its prerequisites are complete.", "NODE_LOCKED", 409);
  }

  const registeredAssessment = input.exerciseId
    ? await assessmentRepository.getAssessmentForOwner(userId, input.exerciseId)
    : null;
  const exercise = registeredAssessment || !input.exerciseId
    ? null
    : await assessmentRepository.getExercise(input.exerciseId);
  if (
    input.exerciseId &&
    !registeredAssessment &&
    (!exercise ||
      exercise.curriculumVersionId !== context.enrollment.curriculumVersionId ||
      exercise.nodeId !== input.nodeId)
  ) {
    reject("The exercise is not part of the enrolled node.", "EXERCISE_NOT_IN_ENROLLMENT", 400);
  }

  const session = await learningRepository.getOrCreateSession(userId, input.enrollmentId, {
    nodeId: input.nodeId,
    skillId: null,
  });
  if (!session) reject("Learning session was not found.", "SESSION_NOT_FOUND", 404);
  if (context.enrollment.currentNodeId !== input.nodeId) {
    await learningRepository.updateEnrollmentCurrentNode(userId, input.enrollmentId, input.nodeId);
  }

  if (registeredAssessment && registeredAssessment.nodeId !== input.nodeId) {
    reject("The assessment is not part of the enrolled node.", "EXERCISE_NOT_IN_ENROLLMENT", 400);
  }
  const prompt = registeredAssessment?.prompt ?? exercise?.prompt ?? {
    title: node.title,
    summary: node.summary,
    completionCriteria: node.completionCriteria,
  };
  const rubric = registeredAssessment?.rubric ?? exercise?.rubric ?? {
    expectedKeywords: [],
    completionCriteria: node.completionCriteria,
  };
  const scored = scoreAnswer(input.answer, rubric, node.completionCriteria);
  const evidence = {
    rule: "DETERMINISTIC_MVP_RUBRIC",
    scoreReason: scored.reason,
    criteriaPassed: scored.criteriaPassed,
    criteriaMissing: node.completionCriteria.filter((criterion) => !scored.criteriaPassed.includes(criterion)),
    answerHash: hashAssessmentAnswer(input.answer),
  };
  const created = await assessmentRepository.createAssessment({
    userId,
    sessionId: session.id,
    enrollmentId: input.enrollmentId,
    nodeId: input.nodeId,
    exerciseId: registeredAssessment ? null : input.exerciseId ?? null,
    assessmentId: registeredAssessment?.id,
    assessmentType: registeredAssessment?.assessmentType ?? toAssessmentType(exercise),
    prompt,
    answer: input.answer,
    rubric,
    score: scored.score,
    evidence,
    answerHash: hashAssessmentAnswer(input.answer),
  });
  const currentProgress = context.progress.find((entry) => entry.nodeId === input.nodeId);
  const recomputed = await new ProgressService(learningRepository, assessmentRepository).recomputeNode({
    userId,
    enrollmentId: input.enrollmentId,
    node,
    currentProgress,
  });
  return {
    assessment: created.assessment,
    created: created.created,
    progress: recomputed.progress,
    decision: recomputed.decision,
  };
}
