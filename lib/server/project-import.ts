import { createId } from "@/lib/ids";
import { normalizeChatAttachments } from "@/lib/chat-attachments";
import { normalizeChatCitations } from "@/lib/chat-citations";
import type {
  BranchType,
  ChatMessage,
  MindNode,
  NodePosition,
  Project,
} from "@/lib/types";

export type ProjectImportOptions = {
  ownerSessionId?: string;
  now?: () => string;
};

export type ProjectImportResult = {
  projects: Project[];
  importedCount: number;
  rejectedCount: number;
};

const BRANCH_TYPES = new Set<BranchType>(["root", "continue", "branch"]);
const MESSAGE_ROLES = new Set<ChatMessage["role"]>(["user", "assistant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanString(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function isoString(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

function normalizePosition(value: unknown): NodePosition {
  if (!isRecord(value)) return { x: 0, y: 0 };

  const x = typeof value.x === "number" && Number.isFinite(value.x) ? value.x : 0;
  const y = typeof value.y === "number" && Number.isFinite(value.y) ? value.y : 0;
  return { x, y };
}

function normalizeBranchType(value: unknown, fallback: BranchType): BranchType {
  return typeof value === "string" && BRANCH_TYPES.has(value as BranchType)
    ? (value as BranchType)
    : fallback;
}

function isProjectLike(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.rootNodeId === "string" &&
    isRecord(value.nodes)
  );
}

function isNodeLike(value: unknown): value is MindNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    Array.isArray(value.children)
  );
}

function extractCandidates(payload: unknown) {
  if (Array.isArray(payload)) return payload;

  if (isRecord(payload)) {
    if (Array.isArray(payload.projects)) return payload.projects;
    if (isProjectLike(payload.project)) return [payload.project];
  }

  return isProjectLike(payload) ? [payload] : [];
}

function createUniqueId(prefix: string, usedIds: Set<string>) {
  let id = createId(prefix);
  while (usedIds.has(id)) id = createId(prefix);
  usedIds.add(id);
  return id;
}

function nodePrefix(branchType: BranchType) {
  return branchType === "root" ? "node_root" : `node_${branchType}`;
}

function normalizeMessages(
  messages: unknown[],
  timestamp: string,
  usedIds: Set<string>,
): ChatMessage[] {
  return messages.flatMap((message) => {
    if (!isRecord(message) || typeof message.content !== "string") return [];
    if (
      typeof message.role !== "string" ||
      !MESSAGE_ROLES.has(message.role as ChatMessage["role"])
    ) {
      return [];
    }

    return {
      id: createUniqueId("msg", usedIds),
      role: message.role as ChatMessage["role"],
      content: message.content,
      attachments: normalizeChatAttachments(message.attachments, {
        createId: () => createUniqueId("attachment", usedIds),
        fallbackCreatedAt: timestamp,
      }),
      citations: normalizeChatCitations(message.citations),
      createdAt: isoString(message.createdAt, timestamp),
    };
  });
}

function getOrderedChildren(node: MindNode, nodesById: Map<string, MindNode>) {
  const fromChildren = node.children.filter((id) => nodesById.has(id));
  const seen = new Set(fromChildren);
  const fromParents = [...nodesById.values()]
    .filter((candidate) => candidate.parentId === node.id && !seen.has(candidate.id))
    .map((candidate) => candidate.id);

  return [...fromChildren, ...fromParents];
}

export function remapProjectForImport(
  project: Project,
  options: ProjectImportOptions = {},
): Project | null {
  const timestamp = options.now?.() ?? new Date().toISOString();
  const sourceNodes = Object.values(project.nodes).filter(isNodeLike);
  const sourceNodesById = new Map(sourceNodes.map((node) => [node.id, node]));
  const rootNode = sourceNodesById.get(project.rootNodeId);

  if (!rootNode) return null;

  const reachableIds: string[] = [];
  const queuedIds = [rootNode.id];
  const seenIds = new Set<string>();

  while (queuedIds.length > 0) {
    const id = queuedIds.shift();
    if (!id || seenIds.has(id)) continue;

    const node = sourceNodesById.get(id);
    if (!node) continue;

    seenIds.add(id);
    reachableIds.push(id);
    queuedIds.push(...getOrderedChildren(node, sourceNodesById));
  }

  const usedIds = new Set<string>();
  const projectId = createUniqueId("project", usedIds);
  const nodeIdMap = new Map<string, string>();

  for (const sourceId of reachableIds) {
    const sourceNode = sourceNodesById.get(sourceId);
    if (!sourceNode) continue;

    const branchType =
      sourceId === rootNode.id
        ? "root"
        : normalizeBranchType(sourceNode.branchType, "continue");
    nodeIdMap.set(sourceId, createUniqueId(nodePrefix(branchType), usedIds));
  }

  const nodes: Record<string, MindNode> = {};

  for (const sourceId of reachableIds) {
    const sourceNode = sourceNodesById.get(sourceId);
    const id = nodeIdMap.get(sourceId);
    if (!sourceNode || !id) continue;

    const parentId =
      sourceId === rootNode.id
        ? null
        : sourceNode.parentId
          ? nodeIdMap.get(sourceNode.parentId) ?? null
          : null;

    if (sourceId !== rootNode.id && !parentId) continue;

    const branchType =
      sourceId === rootNode.id
        ? "root"
        : normalizeBranchType(sourceNode.branchType, "continue");

    nodes[id] = {
      id,
      projectId,
      parentId,
      title: cleanString(sourceNode.title, "Imported node"),
      titleManuallyEdited:
        typeof (sourceNode as { titleManuallyEdited?: unknown }).titleManuallyEdited === "boolean"
          ? sourceNode.titleManuallyEdited
          : false,
      summary: typeof sourceNode.summary === "string" ? sourceNode.summary : "",
      messages: normalizeMessages(sourceNode.messages, timestamp, usedIds),
      children: [],
      position: normalizePosition(sourceNode.position),
      branchType,
      collapsed: Boolean(sourceNode.collapsed),
      createdAt: isoString(sourceNode.createdAt, timestamp),
      updatedAt: isoString(sourceNode.updatedAt, timestamp),
    };
  }

  for (const sourceId of reachableIds) {
    const sourceNode = sourceNodesById.get(sourceId);
    const id = nodeIdMap.get(sourceId);
    const targetNode = id ? nodes[id] : undefined;
    if (!sourceNode || !targetNode) continue;

    targetNode.children = getOrderedChildren(sourceNode, sourceNodesById)
      .map((childId) => nodeIdMap.get(childId))
      .filter((childId): childId is string => {
        if (!childId) return false;
        return Boolean(nodes[childId]);
      });
  }

  const rootNodeId = nodeIdMap.get(rootNode.id);
  if (!rootNodeId || !nodes[rootNodeId]) return null;

  return {
    id: projectId,
    ...(options.ownerSessionId ? { ownerSessionId: options.ownerSessionId } : {}),
    title: cleanString(project.title, "Imported project"),
    notes: typeof (project as { notes?: unknown }).notes === "string" ? project.notes : "",
    rootNodeId,
    nodes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function uniquifyImportedProjectTitles(
  projects: Project[],
  existingTitles: readonly string[],
  copySuffix: (index?: number) => string,
): Project[] {
  const takenTitles = new Set(existingTitles);

  return projects.map((project) => {
    if (!takenTitles.has(project.title)) {
      takenTitles.add(project.title);
      return project;
    }

    let index = 1;
    let title = `${project.title}${copySuffix()}`;
    while (takenTitles.has(title)) {
      index += 1;
      title = `${project.title}${copySuffix(index)}`;
    }

    takenTitles.add(title);
    return { ...project, title };
  });
}

export function prepareProjectImport(
  payload: unknown,
  options: ProjectImportOptions = {},
): ProjectImportResult {
  const candidates = extractCandidates(payload);
  const projects = candidates.flatMap((candidate) => {
    if (!isProjectLike(candidate)) return [];
    const project = remapProjectForImport(candidate, options);
    return project ? [project] : [];
  });

  return {
    projects,
    importedCount: projects.length,
    rejectedCount: candidates.length - projects.length,
  };
}
