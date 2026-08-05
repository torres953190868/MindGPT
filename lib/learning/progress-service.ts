import type { CurriculumNode } from "@/lib/curriculum/curriculum-types";
import type { AssessmentRepository } from "@/lib/learning/assessment-repository";
import type { LearningRepository } from "@/lib/learning/learning-repository";
import { evaluateProgress, type ProgressDecision } from "@/lib/learning/progress-rules";
import type { LearningNodeProgress } from "@/lib/learning/learning-types";

export type RecomputedProgress = {
  progress: LearningNodeProgress;
  decision: ProgressDecision;
};

export class ProgressService {
  constructor(
    private readonly learningRepository: LearningRepository,
    private readonly assessmentRepository: AssessmentRepository,
  ) {}

  async recomputeNode(input: {
    userId: string;
    enrollmentId: string;
    node: CurriculumNode;
    currentProgress?: LearningNodeProgress;
    now?: string;
  }): Promise<RecomputedProgress> {
    const assessments = await this.assessmentRepository.listAssessments(
      input.userId,
      input.enrollmentId,
      input.node.clientId,
    );
    const decision = evaluateProgress({
      node: input.node,
      currentStatus: input.currentProgress?.status ?? "available",
      currentCompletedAt: input.currentProgress?.completedAt,
      assessments,
      now: input.now,
    });
    const latest = assessments.at(-1);
    const saved = await this.learningRepository.upsertProgress(
      input.userId,
      input.enrollmentId,
      input.node.clientId,
      {
        status: decision.status,
        masteryScore: decision.masteryScore,
        attemptCount: decision.attemptCount,
        lastAssessedAt: latest?.createdAt ?? null,
        nextReviewAt: decision.nextReviewAt,
        completedAt: decision.completedAt,
        startedAt:
          input.currentProgress?.startedAt ?? (assessments.length > 0 ? input.now ?? new Date().toISOString() : null),
        lastEvidence: {
          ...decision.evidence,
          reason: decision.reason,
        },
      },
    );
    if (!saved) throw new Error("Learning enrollment was not found.");
    return { progress: saved, decision };
  }
}
