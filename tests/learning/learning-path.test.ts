import { describe, expect, it } from "vitest";
import { buildLearningPath, flattenLearningNodes } from "@/lib/learning/learning-path-service";
import type { LearningNodeProgress } from "@/lib/learning/learning-types";
import { createValidCurriculumDraft } from "../curriculum/fixtures";

function progress(nodeId: string, status: LearningNodeProgress["status"]): LearningNodeProgress {
  return {
    id: `progress-${nodeId}`,
    enrollmentId: "enrollment-1",
    nodeId,
    status,
    masteryScore: 0,
    attemptCount: 0,
    lastEvidence: null,
    lastAssessedAt: null,
    nextReviewAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("LearningPathService", () => {
  it("unlocks only prerequisite-ready nodes and selects the first eligible node", () => {
    const path = buildLearningPath(createValidCurriculumDraft(), [], null);

    expect(path.currentNodeId).toBe("n1");
    expect(path.nodes.find((node) => node.nodeId === "n1")?.status).toBe("available");
    expect(path.nodes.find((node) => node.nodeId === "n2")?.status).toBe("locked");
    expect(path.nodes.find((node) => node.nodeId === "n3")?.status).toBe("locked");
  });

  it("prioritizes review and in-progress nodes without selecting locked nodes", () => {
    const path = buildLearningPath(
      createValidCurriculumDraft(),
      [progress("n1", "completed"), progress("n2", "needs_review")],
      "n3",
    );

    expect(path.currentNodeId).toBe("n2");
    expect(path.nodes.find((node) => node.nodeId === "n2")?.status).toBe("needs_review");
    expect(path.nodes.find((node) => node.nodeId === "n3")?.status).toBe("locked");
    expect(path.nodes.find((node) => node.nodeId === "n3")?.priority).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("flattens nodes in module and node order", () => {
    expect(flattenLearningNodes(createValidCurriculumDraft()).map((node) => node.clientId)).toEqual([
      "n1",
      "n2",
      "n3",
    ]);
  });

  it("promotes due completed nodes into the review queue", () => {
    const due = buildLearningPath(
      createValidCurriculumDraft(),
      [{
        ...progress("n1", "completed"),
        nextReviewAt: "2026-08-04T00:00:00.000Z",
      }],
      null,
      { now: "2026-08-05T00:00:00.000Z" },
    );
    const notDue = buildLearningPath(
      createValidCurriculumDraft(),
      [{
        ...progress("n1", "completed"),
        nextReviewAt: "2026-08-06T00:00:00.000Z",
      }],
      null,
      { now: "2026-08-05T00:00:00.000Z" },
    );

    expect(due.currentNodeId).toBe("n1");
    expect(due.nodes.find((node) => node.nodeId === "n1")).toMatchObject({
      status: "completed",
      reason: "review_due",
    });
    expect(notDue.currentNodeId).not.toBe("n1");
    expect(notDue.nodes.find((node) => node.nodeId === "n1")?.reason).not.toBe("review_due");
  });

  it("prioritizes core candidates over optional candidates in the same tier", () => {
    const draft = createValidCurriculumDraft();
    const courseModule = draft.modules[0];
    const [first, second] = courseModule.nodes;
    if (!first || !second) throw new Error("fixture needs two nodes");
    const optional = { ...first, clientId: "optional-first", importance: "optional" as const, prerequisiteClientIds: [], orderIndex: 0 };
    const core = { ...second, clientId: "core-second", importance: "core" as const, prerequisiteClientIds: [], orderIndex: 1 };
    const path = buildLearningPath({ ...draft, modules: [{ ...courseModule, nodes: [optional, core] }, ...draft.modules.slice(1)] }, [], null);

    expect(path.currentNodeId).toBe("core-second");
  });
});
