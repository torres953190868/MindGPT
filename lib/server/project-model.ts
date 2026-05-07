import { collectDescendantIds, getChildPosition, ROOT_POSITION } from "@/lib/graph";
import { createId } from "@/lib/ids";
import type {
  BranchType,
  ChatMessage,
  MindNode,
  MockReply,
  NodePosition,
  Project,
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: createId("msg"),
    role,
    content,
    createdAt: now(),
  };
}

export function createRootProject(topic: string, reply: MockReply): Project {
  const timestamp = now();
  const projectId = createId("project");
  const nodeId = createId("node_root");
  const rootNode: MindNode = {
    id: nodeId,
    projectId,
    parentId: null,
    title: reply.title,
    summary: reply.summary,
    messages: [makeMessage("user", topic), makeMessage("assistant", reply.content)],
    children: [],
    position: ROOT_POSITION,
    branchType: "root",
    collapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    id: projectId,
    title: topic.trim(),
    rootNodeId: nodeId,
    nodes: { [nodeId]: rootNode },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function addChildNode(
  project: Project,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  instruction: string,
  reply: MockReply,
) {
  const parent = project.nodes[parentId];
  if (!parent) return null;

  const timestamp = now();
  const nodeId = createId(`node_${mode}`);
  const child: MindNode = {
    id: nodeId,
    projectId: project.id,
    parentId,
    title: reply.title,
    summary: reply.summary,
    messages: [makeMessage("user", instruction), makeMessage("assistant", reply.content)],
    children: [],
    position: getChildPosition(
      parent,
      mode,
      parent.children
        .map((childId) => project.nodes[childId])
        .filter((node): node is MindNode => Boolean(node)),
    ),
    branchType: mode,
    collapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    node: child,
    project: {
      ...project,
      nodes: {
        ...project.nodes,
        [parentId]: {
          ...parent,
          children: [...parent.children, nodeId],
          updatedAt: timestamp,
        },
        [nodeId]: child,
      },
      updatedAt: timestamp,
    },
  };
}

export function updateNodePosition(
  project: Project,
  nodeId: string,
  position: NodePosition,
) {
  const node = project.nodes[nodeId];
  if (!node) return null;

  const timestamp = now();
  return {
    ...project,
    nodes: {
      ...project.nodes,
      [nodeId]: { ...node, position, updatedAt: timestamp },
    },
    updatedAt: timestamp,
  };
}

export function setNodeCollapsed(project: Project, nodeId: string, collapsed: boolean) {
  const node = project.nodes[nodeId];
  if (!node) return null;

  const timestamp = now();
  return {
    ...project,
    nodes: {
      ...project.nodes,
      [nodeId]: { ...node, collapsed, updatedAt: timestamp },
    },
    updatedAt: timestamp,
  };
}

export function removeNode(project: Project, nodeId: string) {
  const node = project.nodes[nodeId];
  if (!node || node.parentId === null) return null;

  const idsToDelete = collectDescendantIds(project, nodeId);
  const nodes = { ...project.nodes };
  idsToDelete.forEach((id) => delete nodes[id]);

  const parent = nodes[node.parentId];
  if (parent) {
    nodes[node.parentId] = {
      ...parent,
      children: parent.children.filter((childId) => childId !== nodeId),
      updatedAt: now(),
    };
  }

  return {
    parentId: node.parentId,
    project: {
      ...project,
      nodes,
      updatedAt: now(),
    },
  };
}
