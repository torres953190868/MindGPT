"use client";

import {
  ApiRequestError,
  formatApiErrorMessage,
  getApiErrorMeta,
} from "@/lib/client/api";
import { getChildPosition } from "@/lib/graph";
import { createId } from "@/lib/ids";
import { resolveRegenerateTargets } from "@/lib/message-regeneration";
import type {
  BranchType,
  ChatAttachment,
  ChatMessage,
  MindNode,
  Project,
} from "@/lib/types";

export type NodeStreamingEvent =
  | { type: "delta"; contentDelta: string }
  | { type: "complete"; project: Project; node: MindNode };

type SseEvent = {
  event: string;
  data: string;
};

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

export function createDraftChildProject(
  project: Project,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  instruction: string,
  attachments: ChatAttachment[] = [],
) {
  const parent = project.nodes[parentId];
  if (!parent) return null;

  const timestamp = now();
  const nodeId = createId(`node_${mode}_draft`);
  const assistantMessage = makeMessage("assistant", "");
  const child: MindNode = {
    id: nodeId,
    projectId: project.id,
    parentId,
    title: mode === "branch" ? "Generating branch..." : "Generating continuation...",
    titleManuallyEdited: false,
    summary: "Streaming DeepSeek response.",
    messages: [makeMessage("user", instruction, attachments), assistantMessage],
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
    assistantMessageId: assistantMessage.id,
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

export function createBlankChildProject(
  project: Project,
  parentId: string,
  mode: Exclude<BranchType, "root">,
) {
  const parent = project.nodes[parentId];
  if (!parent) return null;

  const timestamp = now();
  const nodeId = createId(`node_${mode}_blank`);
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

export function createPopulatingBlankNodeProject(
  project: Project,
  nodeId: string,
  instruction: string,
  attachments: ChatAttachment[] = [],
) {
  const node = project.nodes[nodeId];
  const trimmed = instruction.trim();
  if (!node || node.messages.length > 0 || !trimmed) return null;

  const timestamp = now();
  const assistantMessage = makeMessage("assistant", "");
  const nextNode: MindNode = {
    ...node,
    title: node.titleManuallyEdited
      ? node.title
      : node.branchType === "branch"
        ? "Generating branch..."
        : "Generating continuation...",
    summary: "Streaming DeepSeek response.",
    messages: [makeMessage("user", trimmed, attachments), assistantMessage],
    updatedAt: timestamp,
  };

  return {
    assistantMessageId: assistantMessage.id,
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

export function appendDraftAssistantDelta(
  project: Project,
  nodeId: string,
  assistantMessageId: string,
  contentDelta: string,
) {
  const node = project.nodes[nodeId];
  if (!node || !contentDelta) return project;

  return {
    ...project,
    nodes: {
      ...project.nodes,
      [nodeId]: {
        ...node,
        messages: node.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: `${message.content}${contentDelta}` }
            : message,
        ),
        updatedAt: now(),
      },
    },
    updatedAt: now(),
  };
}

export function createRegeneratingNodeProject(
  project: Project,
  nodeId: string,
  update: {
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
  const messages = node.messages.map((message, index) => {
    if (instruction && index === targets.userMessageIndex) {
      return { ...message, content: instruction };
    }

    if (index === targets.assistantMessageIndex) {
      return { ...message, content: "" };
    }

    return message;
  });

  const nextNode = {
    ...node,
    messages,
    updatedAt: timestamp,
  };

  return {
    node: nextNode,
    project: {
      ...project,
      title:
        targets.isLatestAssistant &&
        instruction &&
        nodeId === project.rootNodeId &&
        !node.titleManuallyEdited
          ? instruction
          : project.title,
      nodes: {
        ...project.nodes,
        [nodeId]: nextNode,
      },
      updatedAt: timestamp,
    },
    assistantMessageId: targets.assistantMessage.id,
  };
}

export function removeDraftChildNode(project: Project, nodeId: string) {
  const node = project.nodes[nodeId];
  if (!node?.parentId) return project;

  const parent = project.nodes[node.parentId];
  const nodes = { ...project.nodes };
  delete nodes[nodeId];

  return {
    ...project,
    nodes: {
      ...nodes,
      [node.parentId]: parent
        ? {
            ...parent,
            children: parent.children.filter((childId) => childId !== nodeId),
            updatedAt: now(),
          }
        : parent,
    },
    updatedAt: now(),
  };
}

export function removeNodeProject(project: Project, nodeId: string) {
  const node = project.nodes[nodeId];
  if (!node || node.parentId === null) return null;

  const idsToDelete = new Set<string>();
  const nodesToVisit = [nodeId];

  while (nodesToVisit.length > 0) {
    const currentNodeId = nodesToVisit.pop();
    if (!currentNodeId || idsToDelete.has(currentNodeId)) continue;

    idsToDelete.add(currentNodeId);
    project.nodes[currentNodeId]?.children.forEach((childId) => {
      nodesToVisit.push(childId);
    });
  }

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

function getErrorString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getErrorStatus(payload: Record<string, unknown>) {
  const status = Number(payload.status ?? 500);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

async function assertStreamingResponse(response: Response) {
  if (response.ok) return;

  const data = (await response.json().catch(() => null)) as unknown;
  throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
    ...getApiErrorMeta(data),
    status: response.status,
  });
}

function parseSseEvent(block: string): SseEvent | null {
  const lines = block.split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  return data ? { event, data } : null;
}

function parseNodeStreamingEvent({ event, data }: SseEvent): NodeStreamingEvent | null {
  const payload = JSON.parse(data) as Record<string, unknown>;

  if (event === "delta") {
    return typeof payload.contentDelta === "string"
      ? { type: "delta", contentDelta: payload.contentDelta }
      : null;
  }

  if (event === "complete") {
    return payload.project && payload.node
      ? {
          type: "complete",
          project: payload.project as Project,
          node: payload.node as MindNode,
        }
      : null;
  }

  if (event === "error") {
    const status = getErrorStatus(payload);
    const code = getErrorString(payload, "code");
    const requestId = getErrorString(payload, "requestId");
    const message =
      typeof payload.message === "string" ? payload.message : "Request failed.";
    throw new ApiRequestError(
      requestId ? `${message} (Reference: ${requestId})` : message,
      {
        code,
        requestId,
        status,
      },
    );
  }

  return null;
}

export async function readNodeStreamingEvents(
  response: Response,
  onEvent: (event: NodeStreamingEvent) => void,
) {
  await assertStreamingResponse(response);
  if (!response.body) throw new Error("Server did not return a streaming response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseEvent(block);
      const parsed = event ? parseNodeStreamingEvent(event) : null;
      if (parsed) onEvent(parsed);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  const trailingEvent = parseSseEvent(buffer);
  const parsedTrailingEvent = trailingEvent ? parseNodeStreamingEvent(trailingEvent) : null;
  if (parsedTrailingEvent) onEvent(parsedTrailingEvent);
}

function scheduleFrame(callback: () => void) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(callback, 16);
}

function cancelFrame(handle: number) {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
    return;
  }

  window.clearTimeout(handle);
}

export function createTextDeltaBatch(onFlush: (contentDelta: string) => void) {
  let queued = "";
  let frame: number | null = null;

  function flush() {
    const contentDelta = queued;
    queued = "";
    frame = null;
    if (contentDelta) onFlush(contentDelta);
  }

  return {
    cancel() {
      if (frame !== null) cancelFrame(frame);
      queued = "";
      frame = null;
    },
    flushNow() {
      if (frame !== null) cancelFrame(frame);
      flush();
    },
    push(contentDelta: string) {
      queued += contentDelta;
      if (frame === null) frame = scheduleFrame(flush);
    },
  };
}
