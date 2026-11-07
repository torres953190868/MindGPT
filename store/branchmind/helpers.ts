import type { PendingProjectSyncRecord } from "@/lib/client/pending-project-sync";
import {
  getBranchMindLanguage,
  LANGUAGE_STORAGE_KEY,
} from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import type { NodePosition, Project } from "@/lib/types";
import type {
  ApiErrorPayload,
  BranchMindState,
  PendingNodePositionSyncRecord,
  RegenerateRollback,
} from "./types";

const LEGACY_PROJECTS_KEY = "branchmind.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "branchmind.activeProjectId.v1";

export class ApiRequestError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export function getThrownErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export function getAiMessageLimitFromError(error: unknown): number | null {
  const details = (error as { details?: unknown } | null)?.details;
  const limit = (details as { limit?: unknown } | null)?.limit;
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0
    ? limit
    : null;
}

export function getStoredLanguageCopy() {
  let storedLanguage: string | null = null;
  try {
    storedLanguage =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    storedLanguage = null;
  }

  return LANGUAGE_COPY[getBranchMindLanguage(storedLanguage)];
}

export function getErrorMessage(error: unknown): string {
  if (
    error instanceof ApiRequestError &&
    (error.code === "AUTH_REQUIRED" ||
      error.message === "You need to sign in to do that.")
  ) {
    return getStoredLanguageCopy().auth.authRequired;
  }
  // Streamed AI generation failures carry this code from the SSE/non-OK error
  // path (lib/client/node-streaming), which throws its own ApiRequestError
  // class — match on the code structurally instead of instanceof.
  if (getThrownErrorCode(error) === "AI_MESSAGE_LIMIT_REACHED") {
    const limit = getAiMessageLimitFromError(error);
    if (limit !== null) {
      return getStoredLanguageCopy().workspace.aiMessageLimitReached(limit);
    }
  }
  return error instanceof Error ? error.message : "Request failed.";
}

export function getApiErrorMessage(data: unknown): string | null {
  const payload = data as ApiErrorPayload | null;
  const error = payload?.error;

  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

export function getApiErrorCode(data: unknown): string | null {
  const payload = data as ApiErrorPayload | null;
  const error = payload?.error;

  if (error && typeof error === "object" && typeof error.code === "string") {
    return error.code;
  }

  return null;
}

export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === "NOT_FOUND")
  );
}

export function isNodeConflictError(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  return candidate?.status === 409 || candidate?.code === "NODE_CONFLICT";
}

export function getNodeConflictErrorMessage(): string {
  return getStoredLanguageCopy().workspace.regenerateConflict;
}

export async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw new ApiRequestError(
      getApiErrorMessage(data) ?? "Request failed.",
      response.status,
      getApiErrorCode(data),
    );
  }

  if (!data) {
    throw new Error("Server returned an empty response.");
  }

  return data;
}

export function replaceProject(projects: Project[], nextProject: Project): Project[] {
  return projects.map((project) =>
    project.id === nextProject.id ? nextProject : project,
  );
}

export function upsertProject(projects: Project[], nextProject: Project): Project[] {
  const exists = projects.some((project) => project.id === nextProject.id);
  if (!exists) return [nextProject, ...projects];
  return replaceProject(projects, nextProject);
}

export function getActiveProject(
  projects: Project[],
  activeProjectId: string | null,
): Project | null {
  return (
    projects.find((project) => project.id === activeProjectId) ??
    projects[0] ??
    null
  );
}

export function getSelectedNodeId(
  project: Project | null,
  selectedNodeId: string | null,
): string | null {
  if (!project) return null;
  return selectedNodeId && project.nodes[selectedNodeId]
    ? selectedNodeId
    : project.rootNodeId;
}

export function isProjectWaitingForSync(
  state: Pick<BranchMindState, "pendingProjectSyncs">,
  projectId: string,
): boolean {
  const record = state.pendingProjectSyncs[projectId];
  return Boolean(record && record.status !== "synced");
}

export function nodePositionKey(projectId: string, nodeId: string): string {
  return `${projectId}:${nodeId}`;
}

export function nodeCollapsedKey(projectId: string, nodeId: string): string {
  return `${projectId}:${nodeId}`;
}

export function positionsEqual(left: NodePosition, right: NodePosition): boolean {
  return left.x === right.x && left.y === right.y;
}

export function newestTimestamp(left: string, right?: string): string {
  return right && right > left ? right : left;
}

export function isNodePosition(value: unknown): value is NodePosition {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as NodePosition).x === "number" &&
    typeof (value as NodePosition).y === "number" &&
    Number.isFinite((value as NodePosition).x) &&
    Number.isFinite((value as NodePosition).y)
  );
}

export function isPendingNodePositionSyncRecord(
  value: unknown,
): value is PendingNodePositionSyncRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as PendingNodePositionSyncRecord).projectId === "string" &&
    typeof (value as PendingNodePositionSyncRecord).nodeId === "string" &&
    isNodePosition((value as PendingNodePositionSyncRecord).position) &&
    typeof (value as PendingNodePositionSyncRecord).updatedAt === "string"
  );
}

export function getPendingSyncMap(
  records: PendingProjectSyncRecord[],
): Record<string, PendingProjectSyncRecord> {
  return Object.fromEntries(
    records.map((record) => [record.project.id, record]),
  ) as Record<string, PendingProjectSyncRecord>;
}

export function mergePendingProjects(
  projects: Project[],
  records: PendingProjectSyncRecord[],
): Project[] {
  const projectIds = new Set(projects.map((project) => project.id));
  const localOnlyProjects = records
    .filter((record) => !projectIds.has(record.project.id))
    .map((record) => record.project);

  return [...localOnlyProjects, ...projects];
}

export function applyPendingNodePositionSyncRecords(
  projects: Project[],
  records: PendingNodePositionSyncRecord[],
): { projects: Project[]; pendingRecords: PendingNodePositionSyncRecord[] } {
  let nextProjects = projects;
  const pendingRecords: PendingNodePositionSyncRecord[] = [];

  for (const record of records) {
    const project = nextProjects.find((item) => item.id === record.projectId);
    const node = project?.nodes[record.nodeId];
    if (!project || !node || record.updatedAt <= node.updatedAt) continue;

    pendingRecords.push(record);
    nextProjects = replaceProject(nextProjects, {
      ...project,
      updatedAt: newestTimestamp(project.updatedAt, record.updatedAt),
      nodes: {
        ...project.nodes,
        [record.nodeId]: {
          ...node,
          position: record.position,
          updatedAt: record.updatedAt,
        },
      },
    });
  }

  return { projects: nextProjects, pendingRecords };
}

export function rollbackRegeneratedMessages(
  projects: Project[],
  projectId: string,
  rollback: RegenerateRollback,
): Project[] {
  const project = projects.find((item) => item.id === projectId);
  const node = project?.nodes[rollback.nodeId];
  if (!project || !node) return projects;

  const messages = node.messages.map((message) => {
    if (rollback.userMessage && message.id === rollback.userMessage.id) {
      return { ...message, content: rollback.userMessage.content };
    }

    if (rollback.assistantMessage && message.id === rollback.assistantMessage.id) {
      return {
        ...message,
        content: rollback.assistantMessage.content,
        citations: rollback.assistantMessage.citations,
      };
    }

    return message;
  });

  return replaceProject(projects, {
    ...project,
    title: rollback.title ?? project.title,
    nodes: {
      ...project.nodes,
      [rollback.nodeId]: { ...node, messages },
    },
  });
}

export function readLegacyProjects(): {
  projects: Project[];
  activeProjectId: string | null;
} {
  if (typeof window === "undefined") {
    return { projects: [], activeProjectId: null };
  }

  let activeProjectId: string | null;
  let rawProjects: string | null;
  try {
    activeProjectId = window.localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
    rawProjects = window.localStorage.getItem(LEGACY_PROJECTS_KEY);
  } catch {
    // Storage blocked (e.g. Safari with cookies disabled): no legacy data.
    return { projects: [], activeProjectId: null };
  }
  if (!rawProjects) return { projects: [], activeProjectId };

  try {
    const projects = JSON.parse(rawProjects) as Project[];
    return { projects: Array.isArray(projects) ? projects : [], activeProjectId };
  } catch {
    return { projects: [], activeProjectId };
  }
}

export function clearLegacyProjects(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_PROJECTS_KEY);
    window.localStorage.removeItem(LEGACY_ACTIVE_PROJECT_KEY);
  } catch {
    // The import already succeeded; a leftover legacy copy is harmless.
  }
}
