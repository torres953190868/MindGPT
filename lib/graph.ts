import type { BranchType, MindNode, NodePosition, Project } from "./types";

export const ROOT_POSITION: NodePosition = { x: 120, y: 120 };
const BRANCH_GAP_X = 390;
const CONTINUE_GAP_Y = 290;
const SIBLING_GAP = 92;

export function getContextTitles(project: Project, nodeId: string) {
  const titles: string[] = [];
  let current: MindNode | undefined = project.nodes[nodeId];

  while (current) {
    titles.unshift(current.title);
    current = current.parentId ? project.nodes[current.parentId] : undefined;
  }

  return titles;
}

export function getChildPosition(
  parent: MindNode,
  mode: Exclude<BranchType, "root">,
  siblingNodes: MindNode[] = [],
) {
  const sameDirectionCount = siblingNodes.filter(
    (node) => node.branchType === mode,
  ).length;
  const offset = sameDirectionCount * SIBLING_GAP;

  if (mode === "branch") {
    return {
      x: parent.position.x + BRANCH_GAP_X,
      y: parent.position.y + offset,
    };
  }

  return {
    x: parent.position.x + offset,
    y: parent.position.y + CONTINUE_GAP_Y,
  };
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
