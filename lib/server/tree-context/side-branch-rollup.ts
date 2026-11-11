import { getNodePath } from "@/lib/graph";
import { PENDING_ROOT_SUMMARY, PENDING_ROOT_TITLE } from "@/lib/server/project-model";
import type { SideBranchInsight } from "@/lib/server/tree-context/types";
import type { MindNode, Project } from "@/lib/types";

export const DEFAULT_SIDE_BRANCH_ROLLUP_MAX_CHARS = 1400;

export type ExtractSideBranchRollupInput = {
  project: Project;
  ancestorNodeId: string | null;
  excludeNodeId?: string;
  lookbackDepth: number;
  maxBranches: number;
};

function cleanInlineText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function isCompletedNode(node: MindNode): boolean {
  const title = cleanInlineText(node.title);
  const summary = cleanInlineText(node.summary);
  if (!title || !summary) return false;

  const hasNonEmptyAssistant = node.messages.some(
    (message) => message.role === "assistant" && message.content.trim().length > 0,
  );
  if (!hasNonEmptyAssistant) return false;

  if ((!node.titleManuallyEdited && title === PENDING_ROOT_TITLE) || summary === PENDING_ROOT_SUMMARY) {
    return false;
  }

  return true;
}

function resolveContinueChainLeafSummary(
  project: Project,
  branchNode: MindNode,
  pathNodeIds: ReadonlySet<string>,
  excludeNodeId?: string,
): string | undefined {
  const visited = new Set<string>([branchNode.id]);
  let current: MindNode = branchNode;
  let deepestContinue: MindNode | null = null;

  while (true) {
    let nextContinue: MindNode | undefined;

    for (const childId of current.children) {
      if (visited.has(childId)) continue;
      if (childId === excludeNodeId || pathNodeIds.has(childId)) continue;

      const candidate = project.nodes[childId];
      if (!candidate || candidate.branchType !== "continue") continue;
      if (
        candidate.id === excludeNodeId ||
        visited.has(candidate.id) ||
        pathNodeIds.has(candidate.id)
      ) {
        continue;
      }
      if (!isCompletedNode(candidate)) continue;

      nextContinue = candidate;
      break;
    }

    if (!nextContinue) break;

    visited.add(nextContinue.id);
    deepestContinue = nextContinue;
    current = nextContinue;
  }

  if (!deepestContinue) return undefined;

  const branchSummary = cleanInlineText(branchNode.summary);
  const deepestSummary = cleanInlineText(deepestContinue.summary);
  if (!deepestSummary || deepestSummary === branchSummary) {
    return undefined;
  }

  const deepestTitle = cleanInlineText(deepestContinue.title);
  return deepestTitle ? `${deepestTitle}: ${deepestSummary}` : deepestSummary;
}

/**
 * Extracts completed side-branch (`branchType === "branch"`) takeaways from
 * `ancestorNodeId` and up to `lookbackDepth - 1` prior ancestors along the
 * root-to-parent path, ordered from the closest ancestor backward and preserving
 * deterministic `children` array order within each ancestor.
 */
export function extractSideBranchRollup(
  input: ExtractSideBranchRollupInput,
): SideBranchInsight[] {
  const { project, ancestorNodeId, excludeNodeId, lookbackDepth, maxBranches } = input;
  if (!ancestorNodeId || lookbackDepth <= 0 || maxBranches <= 0) {
    return [];
  }

  const maxBranchCount = Math.floor(maxBranches);
  const maxAnchorCount = Math.floor(lookbackDepth);
  if (maxBranchCount <= 0 || maxAnchorCount <= 0) {
    return [];
  }

  const pathNodes = getNodePath(project, ancestorNodeId);
  if (pathNodes.length === 0) {
    return [];
  }

  const pathNodeIds = new Set(pathNodes.map((node) => node.id));
  const seenNodeIds = new Set<string>();
  const insights: SideBranchInsight[] = [];
  const minIndex = Math.max(0, pathNodes.length - maxAnchorCount);

  for (let index = pathNodes.length - 1; index >= minIndex; index -= 1) {
    const anchorNode = pathNodes[index];
    const parentTitle = cleanInlineText(anchorNode.title) || anchorNode.title;

    for (const childId of anchorNode.children) {
      if (childId === excludeNodeId) continue;
      if (pathNodeIds.has(childId) || seenNodeIds.has(childId)) continue;

      const child = project.nodes[childId];
      if (!child || child.branchType !== "branch") continue;
      if (
        child.id === excludeNodeId ||
        pathNodeIds.has(child.id) ||
        seenNodeIds.has(child.id)
      ) {
        continue;
      }
      if (!isCompletedNode(child)) continue;

      seenNodeIds.add(child.id);
      const leafSummary = resolveContinueChainLeafSummary(
        project,
        child,
        pathNodeIds,
        excludeNodeId,
      );

      insights.push({
        nodeId: child.id,
        parentNodeId: anchorNode.id,
        parentTitle,
        title: cleanInlineText(child.title),
        summary: cleanInlineText(child.summary),
        ...(leafSummary ? { leafSummary } : {}),
      });

      if (insights.length >= maxBranchCount) {
        return insights;
      }
    }
  }

  return insights;
}

function formatInsightLine(insight: SideBranchInsight): string {
  const parentTitle = cleanInlineText(insight.parentTitle);
  const title = cleanInlineText(insight.title);
  const summary = cleanInlineText(insight.summary);
  const leafSummary = insight.leafSummary ? cleanInlineText(insight.leafSummary) : "";

  if (leafSummary) {
    return `- [From "${parentTitle}"] ${title}: ${summary} (Conclusion: ${leafSummary})`;
  }

  return `- [From "${parentTitle}"] ${title}: ${summary}`;
}

/**
 * Renders extracted side-branch insights into a character-budgeted bullet list
 * suitable for prompt injection. Reserves room for `\n...` so the formatted block
 * never exceeds `maxChars`.
 */
export function formatSideBranchRollup(
  insights: SideBranchInsight[],
  maxChars: number = DEFAULT_SIDE_BRANCH_ROLLUP_MAX_CHARS,
): string {
  if (insights.length === 0 || maxChars <= 0) {
    return "";
  }

  const lines = insights.map(formatInsightLine);
  let output = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidate = output ? `${output}\n${line}` : line;
    const isLastLine = index === lines.length - 1;
    const charLimit = isLastLine ? maxChars : maxChars - 4;

    if (candidate.length > charLimit) {
      if (output) return `${output}\n...`;
      return maxChars >= 3 ? "..." : ".".repeat(Math.floor(maxChars));
    }

    output = candidate;
  }

  return output;
}
