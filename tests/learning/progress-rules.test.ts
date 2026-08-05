import { describe, expect, it } from "vitest";
import { evaluateProgress, calculateMasteryScore } from "@/lib/learning/progress-rules";
import type { LearningAssessment } from "@/lib/learning/learning-types";
import { createCurriculumNode } from "../curriculum/fixtures";

function assessment(id: string, score: number, createdAt: string, evidence: unknown = { criteriaPassed: ["Can explain the idea in own words"] }): LearningAssessment {
  return {
    id,
    sessionId: "session-1",
    enrollmentId: "enrollment-1",
    nodeId: "node-1",
    exerciseId: null,
    assessmentType: "quiz",
    prompt: { question: "Explain it." },
    answer: { text: "A considered answer." },
    rubric: {},
    score,
    evidence,
    answerHash: id,
    agentRunId: null,
    createdAt,
  };
}

describe("deterministic progress rules", () => {
  it("uses recent assessments and starts EWMA at the first evidence score", () => {
    const assessments = [
      assessment("a1", 0.9, "2026-08-01T00:00:00.000Z"),
      assessment("a2", 0.9, "2026-08-02T00:00:00.000Z"),
    ];
    expect(calculateMasteryScore(assessments)).toBeCloseTo(0.9);
  });

  it("requires two strong quiz assessments and criteria evidence before completion", () => {
    const node = createCurriculumNode({ clientId: "node-1", completionCriteria: ["Can explain the idea in own words"] });
    const decision = evaluateProgress({
      node,
      currentStatus: "in_progress",
      assessments: [
        assessment("a1", 0.9, "2026-08-01T00:00:00.000Z"),
        assessment("a2", 0.9, "2026-08-02T00:00:00.000Z"),
      ],
      now: "2026-08-05T00:00:00.000Z",
    });

    expect(decision.status).toBe("completed");
    expect(decision.nextReviewAt).toBe("2026-08-12T00:00:00.000Z");
    expect(decision.evidence.rule).toBe("COMPLETION_CRITERIA_MET");
  });

  it("moves weak recent evidence to needs_review with an explanation", () => {
    const node = createCurriculumNode({ clientId: "node-1" });
    const decision = evaluateProgress({
      node,
      currentStatus: "in_progress",
      assessments: [assessment("a1", 0.4, "2026-08-01T00:00:00.000Z")],
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.reason).toContain("复习");
    expect(decision.nextReviewAt).toBeNull();
  });

  it("keeps a completed node completed after a passing review and reschedules by mastery", () => {
    const node = createCurriculumNode({ clientId: "node-1" });

    const strongReview = evaluateProgress({
      node,
      currentStatus: "completed",
      currentCompletedAt: "2026-08-01T00:00:00.000Z",
      assessments: [assessment("a1", 0.95, "2026-08-04T00:00:00.000Z")],
      now: "2026-08-05T00:00:00.000Z",
    });
    expect(strongReview.status).toBe("completed");
    expect(strongReview.evidence.rule).toBe("COMPLETED_REVIEW_RETAINED");
    expect(strongReview.nextReviewAt).toBe("2026-08-12T00:00:00.000Z");
    expect(strongReview.completedAt).toBe("2026-08-01T00:00:00.000Z");

    const standardReview = evaluateProgress({
      node,
      currentStatus: "completed",
      currentCompletedAt: "2026-08-01T00:00:00.000Z",
      assessments: [assessment("a1", 0.87, "2026-08-04T00:00:00.000Z")],
      now: "2026-08-05T00:00:00.000Z",
    });
    expect(standardReview.status).toBe("completed");
    expect(standardReview.evidence.rule).toBe("COMPLETED_REVIEW_RETAINED");
    expect(standardReview.nextReviewAt).toBe("2026-08-08T00:00:00.000Z");
    expect(standardReview.completedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("demotes a completed node to needs_review when the review quiz drops below 0.6", () => {
    const node = createCurriculumNode({ clientId: "node-1" });
    const decision = evaluateProgress({
      node,
      currentStatus: "completed",
      currentCompletedAt: "2026-08-01T00:00:00.000Z",
      assessments: [assessment("a1", 0.5, "2026-08-04T00:00:00.000Z")],
      now: "2026-08-05T00:00:00.000Z",
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.evidence.rule).toBe("COMPLETED_REVIEW_FAILED");
    expect(decision.nextReviewAt).toBeNull();
    expect(decision.completedAt).toBeNull();
  });
});

