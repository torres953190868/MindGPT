import { collectDescendantIds, getChildPosition, ROOT_POSITION } from "@/lib/graph";
import { createId } from "@/lib/ids";
import { resolveRegenerateTargets } from "@/lib/message-regeneration";
import type {
  BranchType,
  ChatAttachment,
  ChatCitation,
  ChatMessage,
  MindNode,
  MockReply,
  NodePosition,
  Project,
} from "@/lib/types";

export const PENDING_ROOT_TITLE = "Generating answer...";
export const PENDING_ROOT_SUMMARY = "Streaming AI response.";

function now() {
  return new Date().toISOString();
}

function makeMessage(
  role: ChatMessage["role"],
  content: string,
  attachments: ChatAttachment[] = [],
  citations: ChatCitation[] = [],
): ChatMessage {
  const message: ChatMessage = {
    id: createId("msg"),
    role,
    content,
    attachments,
    createdAt: now(),
  };

  if (citations.length > 0) message.citations = citations;
  return message;
}

export function createRootProject(
  topic: string,
  reply: MockReply,
  attachments: ChatAttachment[] = [],
): Project {
  const timestamp = now();
  const projectId = createId("project");
  const nodeId = createId("node_root");
  const rootNode: MindNode = {
    id: nodeId,
    projectId,
    parentId: null,
    title: reply.title,
    titleManuallyEdited: false,
    summary: reply.summary,
    messages: [
      makeMessage("user", topic, attachments),
      makeMessage("assistant", reply.content, [], reply.citations ?? []),
    ],
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

export function createPendingRootProject(
  topic: string,
  attachments: ChatAttachment[] = [],
) {
  const timestamp = now();
  const projectId = createId("project");
  const nodeId = createId("node_root");
  const assistantMessage = makeMessage("assistant", "");
  const rootNode: MindNode = {
    id: nodeId,
    projectId,
    parentId: null,
    title: PENDING_ROOT_TITLE,
    titleManuallyEdited: false,
    summary: PENDING_ROOT_SUMMARY,
    messages: [makeMessage("user", topic, attachments), assistantMessage],
    children: [],
    position: ROOT_POSITION,
    branchType: "root",
    collapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    assistantMessageId: assistantMessage.id,
    node: rootNode,
    project: {
      id: projectId,
      title: topic.trim(),
      notes: "",
      rootNodeId: nodeId,
      nodes: { [nodeId]: rootNode },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
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
    titleManuallyEdited: false,
    summary: reply.summary,
    messages: [
      makeMessage("user", instruction, attachments),
      makeMessage("assistant", reply.content, [], reply.citations ?? []),
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

export function addBlankChildNode(
  project: Project,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  nodeId = createId(`node_${mode}_blank`),
) {
  const parent = project.nodes[parentId];
  if (!parent || project.nodes[nodeId]) return null;

  const timestamp = now();
  const child: MindNode = {
    id: nodeId,
    projectId: project.id,
    parentId,
    title: mode === "branch" ? "New branch" : "New continuation",
    titleManuallyEdited: false,
    summary: "Write the first message from the node detail panel.",
    messages: [],
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

export function populateBlankNode(
  project: Project,
  nodeId: string,
  instruction: string,
  reply: MockReply,
  attachments: ChatAttachment[] = [],
) {
  const node = project.nodes[nodeId];
  const trimmed = instruction.trim();
  if (!node || node.messages.length > 0 || !trimmed) return null;

  const timestamp = now();
  const nextNode: MindNode = {
    ...node,
    title: node.titleManuallyEdited ? node.title : reply.title,
    summary: reply.summary,
    messages: [
      makeMessage("user", trimmed, attachments),
      makeMessage("assistant", reply.content, [], reply.citations ?? []),
    ],
    updatedAt: timestamp,
  };

  return {
    node: nextNode,
    project: {
      ...project,
      nodes: {
        ...project.nodes,
        [nodeId]: nextNode,
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

  const targets = resolveRegenerateTargets(node.messages, update);
  if (!targets) return null;

  const timestamp = now();
  const nextMessages = node.messages.map((message, index) => {
    if (instruction && index === targets.userMessageIndex) {
      return { ...message, content: instruction };
    }

    if (index === targets.assistantMessageIndex) {
      return {
        ...message,
        content: update.reply.content,
        citations: update.reply.citations,
      };
    }

    return message;
  });
  const nextNode = {
    ...node,
    title:
      targets.isLatestAssistant && !node.titleManuallyEdited
        ? update.reply.title
        : node.title,
    summary: targets.isLatestAssistant ? update.reply.summary : node.summary,
    messages: nextMessages,
    updatedAt: timestamp,
  };
  const nextProjectTitle =
    targets.isLatestAssistant && nodeId === project.rootNodeId && nextNode.titleManuallyEdited
      ? nextNode.title
      : targets.isLatestAssistant && instruction && nodeId === project.rootNodeId
        ? instruction
        : project.title;

  return {
    node: nextNode,
    project: {
      ...project,
      title: nextProjectTitle,
      nodes: {
        ...project.nodes,
        [nodeId]: nextNode,
      },
      updatedAt: timestamp,
    },
  };
}

export function updateNodeTitle(project: Project, nodeId: string, title: string) {
  const node = project.nodes[nodeId];
  const nextTitle = title.trim();
  if (!node || !nextTitle) return null;

  const timestamp = now();
  const nextNode: MindNode = {
    ...node,
    title: nextTitle,
    titleManuallyEdited: true,
    updatedAt: timestamp,
  };

  return {
    ...project,
    title: nodeId === project.rootNodeId ? nextTitle : project.title,
    nodes: {
      ...project.nodes,
      [nodeId]: nextNode,
    },
    updatedAt: timestamp,
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

export function setProjectTitle(project: Project, title: string) {
  const nextTitle = title.trim();
  if (!nextTitle) return null;

  const timestamp = now();
  return {
    ...project,
    title: nextTitle,
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
