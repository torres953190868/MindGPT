import { collectDescendantIds, getChildPosition, ROOT_POSITION } from "@/lib/graph";
import { createId } from "@/lib/ids";
import type {
  BranchType,
  ChatAttachment,
  ChatMessage,
  MindNode,
  MockReply,
  NodePosition,
  Project,
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function makeMessage(
  role: ChatMessage["role"],
  content: string,
  attachments: ChatAttachment[] = [],
): ChatMessage {
  return {
    id: createId("msg"),
    role,
    content,
    attachments,
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
    notes: "",
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
  attachments: ChatAttachment[] = [],
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
    messages: [
      makeMessage("user", instruction, attachments),
      makeMessage("assistant", reply.content),
    ],
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

export function regenerateNode(
  project: Project,
  nodeId: string,
  update: {
    reply: MockReply;
    instruction?: string;
    userMessageId?: string;
    assistantMessageId?: string;
  },
) {
  const node = project.nodes[nodeId];
  if (!node) return null;

  const instruction =
    typeof update.instruction === "string" ? update.instruction.trim() : undefined;
  if (typeof update.instruction === "string" && !instruction) return null;

  const userMessageIndex =
    typeof update.userMessageId === "string"
      ? node.messages.findIndex(
          (message) => message.id === update.userMessageId && message.role === "user",
        )
      : node.messages.findIndex((message) => message.role === "user");
  const assistantMessageIndex =
    typeof update.assistantMessageId === "string"
      ? node.messages.findIndex(
          (message) =>
            message.id === update.assistantMessageId && message.role === "assistant",
        )
      : node.messages.findLastIndex((message) => message.role === "assistant");

  if ((instruction || update.userMessageId) && userMessageIndex < 0) return null;
  if (assistantMessageIndex < 0) return null;

  const timestamp = now();
  const nextMessages = node.messages.map((message, index) => {
    if (instruction && index === userMessageIndex) {
      return { ...message, content: instruction };
    }

    if (index === assistantMessageIndex) {
      return { ...message, content: update.reply.content };
    }

    return message;
  });
  const nextNode = {
    ...node,
    title: update.reply.title,
    summary: update.reply.summary,
    messages: nextMessages,
    updatedAt: timestamp,
  };

  return {
    node: nextNode,
    project: {
      ...project,
      title: instruction && nodeId === project.rootNodeId ? instruction : project.title,
      nodes: {
        ...project.nodes,
        [nodeId]: nextNode,
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

export function setProjectNotes(project: Project, notes: string) {
  const timestamp = now();

  return {
    ...project,
    notes,
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
