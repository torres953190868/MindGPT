import type { BranchType, ChatMessage, MindNode, NodePosition, Project } from "./types";

export const ROOT_POSITION: NodePosition = { x: 120, y: 120 };
const BRANCH_GAP_X = 390;
const CONTINUE_GAP_Y = 290;
const NODE_LAYOUT_WIDTH = 316;
const NODE_LAYOUT_HEIGHT = 240;
const NODE_LAYOUT_GAP = 24;
const BRANCH_SIBLING_GAP_Y = NODE_LAYOUT_HEIGHT + NODE_LAYOUT_GAP;
const CONTINUE_SIBLING_GAP_X = NODE_LAYOUT_WIDTH + NODE_LAYOUT_GAP;
const MAX_LAYOUT_LANES = 32;

export function getContextTitles(project: Project, nodeId: string) {
  const titles: string[] = [];
  let current: MindNode | undefined = project.nodes[nodeId];

  while (current) {
    titles.unshift(current.title);
    current = current.parentId ? project.nodes[current.parentId] : undefined;
  }

  return titles;
}

export type ConversationMessageItem = {
  sourceNodeId: string;
  message: ChatMessage;
  inherited: boolean;
};

export function getNodePath(project: Project, nodeId: string) {
  const path: MindNode[] = [];
  const visited = new Set<string>();
  let current: MindNode | undefined = project.nodes[nodeId];

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? project.nodes[current.parentId] : undefined;
  }

  return path;
}

export function getNodeConversationMessages(
  project: Project,
  nodeId: string,
): ConversationMessageItem[] {
  return getNodePath(project, nodeId).flatMap((node) =>
    node.messages.map((message) => ({
      sourceNodeId: node.id,
      message,
      inherited: node.id !== nodeId,
    })),
  );
}

export function getChildPosition(
  parent: MindNode,
  mode: Exclude<BranchType, "root">,
  occupiedNodes: MindNode[] = [],
) {
  const preferredPosition =
    mode === "branch"
      ? { x: parent.position.x + BRANCH_GAP_X, y: parent.position.y }
      : { x: parent.position.x, y: parent.position.y + CONTINUE_GAP_Y };

  for (let primaryLane = 0; primaryLane < MAX_LAYOUT_LANES; primaryLane += 1) {
    for (const lateralLane of getLayoutLanes(MAX_LAYOUT_LANES)) {
      const candidate =
        mode === "branch"
          ? {
              x: preferredPosition.x + primaryLane * BRANCH_GAP_X,
              y: preferredPosition.y + lateralLane * BRANCH_SIBLING_GAP_Y,
            }
          : {
              x: preferredPosition.x + lateralLane * CONTINUE_SIBLING_GAP_X,
              y: preferredPosition.y + primaryLane * CONTINUE_GAP_Y,
            };

      if (!hasPositionCollision(candidate, occupiedNodes)) return candidate;
    }
  }

  return preferredPosition;
}

function getLayoutLanes(maxLane: number) {
  const lanes = [0];

  for (let lane = 1; lane < maxLane; lane += 1) {
    lanes.push(lane, -lane);
  }

  return lanes;
}

function hasPositionCollision(candidate: NodePosition, occupiedNodes: MindNode[]) {
  return occupiedNodes.some((node) => {
    const horizontalOverlap =
      candidate.x < node.position.x + NODE_LAYOUT_WIDTH &&
      candidate.x + NODE_LAYOUT_WIDTH > node.position.x;
    const verticalOverlap =
      candidate.y < node.position.y + NODE_LAYOUT_HEIGHT &&
      candidate.y + NODE_LAYOUT_HEIGHT > node.position.y;

    return horizontalOverlap && verticalOverlap;
  });
}

export function getVisibleNodeIds(project: Project) {
  const visible = new Set<string>();

  function visit(nodeId: string) {
    const node = project.nodes[nodeId];
    if (!node) return;

    visible.add(nodeId);
    if (node.collapsed) return;

    node.children.forEach(visit);
  }

  visit(project.rootNodeId);
  return visible;
}

export function collectDescendantIds(project: Project, nodeId: string) {
  const ids: string[] = [];

  function visit(currentId: string) {
    const node = project.nodes[currentId];
    if (!node) return;

    ids.push(currentId);
    node.children.forEach(visit);
  }

  visit(nodeId);
  return ids;
}
