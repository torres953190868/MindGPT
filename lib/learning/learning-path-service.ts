import type { CurriculumDraft, CurriculumNode, CurriculumNodeStatus } from "@/lib/curriculum/curriculum-types";
import type {
  LearningNodeProgress,
  LearningPath,
  EligibleNode,
  RequestedNodeEvaluation,
} from "@/lib/learning/learning-types";

// Keep this ordering deterministic: core material must not be displaced by
// advanced/optional material that happens to have a lower official index.
export const LEARNING_PATH_IMPORTANCE_WEIGHT = {
  core: 0,
  advanced: 1,
  optional: 2,
} as const;

export type LearningPathNode = CurriculumNode & { moduleOrderIndex: number };

export function flattenLearningNodes(draft: CurriculumDraft): LearningPathNode[] {
  return draft.modules
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .flatMap((courseModule) =>
      courseModule.nodes
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((node) => ({ ...node, moduleOrderIndex: courseModule.orderIndex })),
    );
}

function deriveStatus(
  node: LearningPathNode,
  progress: LearningNodeProgress | undefined,
  completedNodeIds: Set<string>,
): CurriculumNodeStatus {
  if (progress?.status === "completed") return "completed";
  const prerequisitesCompleted = node.prerequisiteClientIds.every((id) =>
    completedNodeIds.has(id),
  );
  if (!prerequisitesCompleted) return "locked";
  if (progress?.status === "in_progress") return "in_progress";
  if (progress?.status === "needs_review") return "needs_review";
  return "available";
}

function priorityFor(status: CurriculumNodeStatus, node: LearningPathNode) {
  if (status === "in_progress") return 0;
  if (status === "needs_review") return 1;
  if (status === "available") {
    return 10
      + LEARNING_PATH_IMPORTANCE_WEIGHT[node.importance] * 1_000_000
      + node.moduleOrderIndex * 1_000
      + node.orderIndex;
  }
  return Number.MAX_SAFE_INTEGER;
}

function isReviewDue(progress: LearningNodeProgress | undefined, now: string) {
  return Boolean(
    progress?.status === "completed" &&
      progress.nextReviewAt &&
      Date.parse(progress.nextReviewAt) <= Date.parse(now),
  );
}

export function buildLearningPath(
  draft: CurriculumDraft,
  progressRows: LearningNodeProgress[],
  currentNodeId: string | null,
  options: { now?: string } = {},
): LearningPath {
  const now = options.now ?? new Date().toISOString();
  const nodes = flattenLearningNodes(draft);
  const progressByNode = new Map(progressRows.map((row) => [row.nodeId, row]));
  const completedNodeIds = new Set(
    progressRows.filter((row) => row.status === "completed").map((row) => row.nodeId),
  );

  // Prerequisites are evaluated against the derived completed set in a few
  // passes so a chain can unlock deterministically even when progress rows
  // for later nodes have not been materialized yet.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        progressByNode.get(node.clientId)?.status === "completed" &&
        !completedNodeIds.has(node.clientId)
      ) {
        completedNodeIds.add(node.clientId);
        changed = true;
      }
    }
  }

  const eligibleNodes: EligibleNode[] = nodes.map((node) => {
    const status = deriveStatus(node, progressByNode.get(node.clientId), completedNodeIds);
    const reviewDue = isReviewDue(progressByNode.get(node.clientId), now);
    const reason = reviewDue
      ? "review_due"
      : status === "locked"
        ? "Complete the prerequisites first."
        : status === "needs_review"
          ? "Review this node before moving on."
          : status === "in_progress"
            ? "Continue the active lesson."
            : status === "completed"
              ? "This node is complete."
              : "Prerequisites are satisfied.";
    return {
      nodeId: node.clientId,
      title: node.title,
      status,
      reason,
      priority: reviewDue ? 2 : priorityFor(status, node),
    };
  });

  const candidates = eligibleNodes
    .filter(
      (node) =>
        node.status === "in_progress" ||
        node.status === "needs_review" ||
        node.status === "available" ||
        node.reason === "review_due",
    )
    .sort((left, right) => left.priority - right.priority || left.nodeId.localeCompare(right.nodeId));
  const current = candidates.find((node) => node.nodeId === currentNodeId) ?? candidates[0] ?? null;

  return {
    currentNodeId: current?.nodeId ?? null,
    nodes: eligibleNodes,
    completedNodeIds: [...completedNodeIds].sort(),
  };
}

export function evaluateRequestedNode(
  nodeId: string,
  progressRows: LearningNodeProgress[],
  graph: CurriculumDraft | LearningPathNode[],
  options: { now?: string } = {},
): RequestedNodeEvaluation {
  const nodes = Array.isArray(graph) ? graph : flattenLearningNodes(graph);
  const nodeById = new Map(nodes.map((node) => [node.clientId, node]));
  const node = nodeById.get(nodeId);
  const completed = new Set(
    progressRows.filter((row) => row.status === "completed").map((row) => row.nodeId),
  );
  const path = Array.isArray(graph)
    ? null
    : buildLearningPath(graph, progressRows, nodeId, options);
  const pathNode =
    path?.nodes.find((entry) => entry.nodeId === nodeId) ??
    (node
      ? {
          nodeId: node.clientId,
          title: node.title,
          status: deriveStatus(node, progressRows.find((row) => row.nodeId === node.clientId), completed),
          reason: "",
          priority: 0,
        }
      : null);
  if (!node || !pathNode) {
    return {
      node: null,
      allowed: false,
      missingPrerequisites: [],
      reason: "The requested node is not part of the enrolled curriculum version.",
    };
  }

  const missingIds = new Set<string>();
  const visitPrerequisites = (candidate: LearningPathNode) => {
    for (const prerequisiteId of candidate.prerequisiteClientIds) {
      if (completed.has(prerequisiteId)) continue;
      const prerequisite = nodeById.get(prerequisiteId);
      if (!prerequisite) continue;
      missingIds.add(prerequisiteId);
      visitPrerequisites(prerequisite);
    }
  };
  visitPrerequisites(node);
  const orderedMissing = nodes
    .filter((candidate) => missingIds.has(candidate.clientId))
    .map((candidate) => ({ nodeId: candidate.clientId, title: candidate.title }));
  const allowed =
    pathNode.status === "available" ||
    pathNode.status === "in_progress" ||
    pathNode.status === "needs_review" ||
    pathNode.reason === "review_due";
  return {
    node: pathNode,
    allowed,
    missingPrerequisites: orderedMissing,
    reason: allowed
      ? "The requested node is available for learning."
      : "Complete the prerequisite nodes before studying this node.",
  };
}
