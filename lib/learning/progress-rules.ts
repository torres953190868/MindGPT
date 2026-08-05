import type { CurriculumNode } from "@/lib/curriculum/curriculum-types";
import type { LearningAssessment, LearningNodeProgress } from "@/lib/learning/learning-types";

export const PROGRESS_RULES_CONFIG = {
  masteryAlpha: 0.5,
  recentAssessmentLimit: 5,
  explanationEvidenceWeight: 0.4,
  minimumCompletionAssessments: 2,
  reviewScoreThreshold: 0.6,
  completionScoreThreshold: 0.8,
  completionMasteryThreshold: 0.85,
  strongMasteryThreshold: 0.9,
  reviewDaysForStrongMastery: 7,
  reviewDaysForCompletionMastery: 3,
} as const;

export type ProgressDecision = {
  masteryScore: number;
  status: LearningNodeProgress["status"];
  attemptCount: number;
  nextReviewAt: string | null;
  completedAt: string | null;
  reason: string;
  evidence: {
    rule: string;
    assessmentIds: string[];
    latestScore: number | null;
    criteriaPassed: string[];
    criteriaMissing: string[];
  };
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function evidenceWeight(assessment: LearningAssessment) {
  return assessment.assessmentType === "explanation"
    ? PROGRESS_RULES_CONFIG.explanationEvidenceWeight
    : 1;
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function criteriaPassedFor(assessment: LearningAssessment): string[] {
  const value = evidenceRecord(assessment.evidence).criteriaPassed;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isQuizLike(assessment: LearningAssessment) {
  return assessment.assessmentType === "quiz" || assessment.assessmentType === "exercise";
}

export function calculateMasteryScore(assessments: LearningAssessment[]) {
  const recent = [...assessments]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-PROGRESS_RULES_CONFIG.recentAssessmentLimit);
  let mastery = 0;
  for (const [index, assessment] of recent.entries()) {
    const weightedScore = clamp(assessment.score) * evidenceWeight(assessment);
    mastery = index === 0
      ? weightedScore
      : mastery * (1 - PROGRESS_RULES_CONFIG.masteryAlpha) +
        weightedScore * PROGRESS_RULES_CONFIG.masteryAlpha;
  }
  return clamp(mastery);
}

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function evaluateProgress(input: {
  node: CurriculumNode;
  currentStatus: LearningNodeProgress["status"];
  currentCompletedAt?: string | null;
  assessments: LearningAssessment[];
  now?: string;
}): ProgressDecision {
  const ordered = [...input.assessments].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = ordered.at(-1) ?? null;
  const quizAssessments = ordered.filter(isQuizLike);
  const latestQuiz = quizAssessments.at(-1) ?? null;
  const masteryScore = calculateMasteryScore(ordered);
  const criteriaPassed = [...new Set(ordered.flatMap(criteriaPassedFor))];
  const criteriaMissing = input.node.completionCriteria.filter(
    (criterion) => !criteriaPassed.includes(criterion),
  );
  const now = input.now ?? new Date().toISOString();
  const assessmentIds = ordered.map((assessment) => assessment.id);

  if (ordered.length === 0) {
    return {
      masteryScore: 0,
      status: input.currentStatus,
      attemptCount: 0,
      nextReviewAt: null,
      completedAt: input.currentCompletedAt ?? null,
      reason: "没有服务端评估记录，保持当前状态；客户端和 Tutor 建议不会改变掌握度。",
      evidence: {
        rule: "NO_ASSESSMENT",
        assessmentIds,
        latestScore: null,
        criteriaPassed,
        criteriaMissing,
      },
    };
  }

  const lowRecentScore = latestQuiz !== null && latestQuiz.score < PROGRESS_RULES_CONFIG.reviewScoreThreshold;
  const canComplete =
    latestQuiz !== null &&
    latestQuiz.score >= PROGRESS_RULES_CONFIG.completionScoreThreshold &&
    masteryScore >= PROGRESS_RULES_CONFIG.completionMasteryThreshold &&
    criteriaMissing.length === 0 &&
    quizAssessments.length >= PROGRESS_RULES_CONFIG.minimumCompletionAssessments;

  let status: LearningNodeProgress["status"];
  let rule: string;
  let reason: string;
  if (input.currentStatus === "completed" && lowRecentScore) {
    status = "needs_review";
    rule = "COMPLETED_REVIEW_FAILED";
    reason = "最近一次测验低于复习阈值 0.6，已降级为 needs_review。";
  } else if (canComplete) {
    status = "completed";
    rule = "COMPLETION_CRITERIA_MET";
    reason = "最近一次测验、掌握度、完成标准和至少两次独立评估均满足完成规则。";
  } else if (lowRecentScore || masteryScore < PROGRESS_RULES_CONFIG.reviewScoreThreshold) {
    status = "needs_review";
    rule = "MASTERY_BELOW_REVIEW_THRESHOLD";
    reason = "最近一次测验或时间衰减掌握度低于 0.6，需要复习。";
  } else if (input.currentStatus === "completed") {
    status = "completed";
    rule = "COMPLETED_REVIEW_RETAINED";
    reason = "复习评估未低于 0.6，保持 completed。";
  } else {
    status = "in_progress";
    rule = "ASSESSMENT_STARTED_NODE";
    reason = "已有服务端评估记录，但尚未满足 completed 的全部条件。";
  }

  const nextReviewAt =
    status === "completed"
      ? addDays(
          now,
          masteryScore >= PROGRESS_RULES_CONFIG.strongMasteryThreshold
            ? PROGRESS_RULES_CONFIG.reviewDaysForStrongMastery
            : PROGRESS_RULES_CONFIG.reviewDaysForCompletionMastery,
        )
      : null;

  return {
    masteryScore,
    status,
    attemptCount: ordered.length,
    nextReviewAt,
    completedAt: status === "completed" ? input.currentCompletedAt ?? now : null,
    reason,
    evidence: {
      rule,
      assessmentIds,
      latestScore: latest?.score ?? null,
      criteriaPassed,
      criteriaMissing,
    },
  };
}
