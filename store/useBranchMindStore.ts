"use client";

import { create } from "zustand";
import type { StoreApi } from "zustand";
import {
  appendDraftAssistantDelta,
  createBlankChildProject,
  createDraftChildProject,
  createPopulatingBlankNodeProject,
  createRegeneratingNodeProject,
  createTextDeltaBatch,
  readNodeStreamingEvents,
  removeDraftChildNode,
  removeNodeProject,
} from "@/lib/client/node-streaming";
import {
  createPendingProjectSyncRecord,
  readPendingProjectSyncRecords,
  removePendingProjectSyncRecord,
  type PendingProjectSyncRecord,
  upsertPendingProjectSyncRecord,
} from "@/lib/client/pending-project-sync";
import {
  getBranchMindLanguage,
  LANGUAGE_STORAGE_KEY,
} from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import type {
  BranchType,
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  ChatSkill,
  MindNode,
  NodePosition,
  Project,
} from "@/lib/types";

const LEGACY_PROJECTS_KEY = "branchmind.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "branchmind.activeProjectId.v1";
const PENDING_NODE_POSITION_SYNC_KEY = "branchmind.pendingNodePositionSync.v1";
const NODE_POSITION_SYNC_DELAY_MS = 750;
const NODE_POSITION_SYNC_RETRY_DELAY_MS = 5_000;

const inFlightProjectSyncs = new Set<string>();
const pendingNodePositionVersions = new Map<string, number>();
const pendingNodePositionSyncs = new Map<string, PendingNodePositionSync>();
let nextNodePositionVersion = 0;
let nodePositionFlushListenersInstalled = false;

type PendingNodePositionSync = PendingNodePositionSyncRecord & {
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type PendingInitialProjectStream = {
  projectId: string;
  nodeId: string;
  assistantMessageId: string;
  modelSelection?: ChatModelSelection;
  skill?: ChatSkill;
};

type PendingNodePositionSyncRecord = {
  projectId: string;
  nodeId: string;
  position: NodePosition;
  updatedAt: string;
};

type BlankChildNodeCreation = {
  nodeId: string;
  persisted: Promise<string | null>;
};

type StoredPendingNodePositionSyncs = {
  version: 1;
  records: PendingNodePositionSyncRecord[];
};

type BranchMindState = {
  projects: Project[];
  activeProjectId: string | null;
  selectedNodeId: string | null;
  hydrated: boolean;
  creatingProject: boolean;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  streamingMessageId: string | null;
  pendingInitialProjectStream: PendingInitialProjectStream | null;
  pendingProjectSyncs: Record<string, PendingProjectSyncRecord>;
  aiError: string | null;
  hydrate: (options?: { force?: boolean }) => Promise<void>;
  clearAiError: () => void;
  createProject: (
    topic: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  startPendingInitialProjectStream: (projectId: string) => void;
  retryPendingProjectSync: (projectId: string) => void;
  deleteProject: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => void;
  selectNode: (nodeId: string) => void;
  createChildNode: (
    parentId: string,
    mode: Exclude<BranchType, "root">,
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  createBlankChildNode: (
    parentId: string,
    mode: Exclude<BranchType, "root">,
  ) => BlankChildNodeCreation | null;
  populateBlankNode: (
    nodeId: string,
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  editUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  retryAssistantMessage: (
    nodeId: string,
    assistantMessageId: string,
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  updateProjectTitle: (projectId: string, title: string) => Promise<boolean>;
  updateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
  updateNodeTitle: (nodeId: string, title: string) => Promise<boolean>;
  updateNodePosition: (nodeId: string, position: NodePosition) => Promise<void>;
  toggleNodeCollapsed: (nodeId: string) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
};

type ProjectsResponse = {
  projects: Project[];
};

type CreateProjectResponse = ProjectsResponse & {
  project: Project;
  initialStream?: {
    nodeId: string;
    assistantMessageId: string;
  };
};

type SyncProjectResponse = {
  project: Project;
};

type UpdateNodeResponse = {
  project: Project;
  node?: MindNode;
  selectedNodeId?: string;
};

type UpdateProjectResponse = {
  project: Project;
};

type ApiErrorPayload = {
  error?: string | {
    code?: string;
    message?: string;
  };
};

class ApiRequestError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function getApiErrorMessage(data: unknown) {
  const payload = data as ApiErrorPayload | null;
  const error = payload?.error;

  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function getApiErrorCode(data: unknown) {
  const payload = data as ApiErrorPayload | null;
  const error = payload?.error;

  if (error && typeof error === "object" && typeof error.code === "string") {
    return error.code;
  }

  return null;
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === "NOT_FOUND")
  );
}

function isNodeConflictError(error: unknown) {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  return candidate?.status === 409 || candidate?.code === "NODE_CONFLICT";
}

function getNodeConflictErrorMessage() {
  let storedLanguage: string | null = null;
  try {
    storedLanguage =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    storedLanguage = null;
  }

  return LANGUAGE_COPY[getBranchMindLanguage(storedLanguage)].workspace
    .regenerateConflict;
}

type RegenerateRollback = {
  nodeId: string;
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
  title?: string;
};

function rollbackRegeneratedMessages(
  projects: Project[],
  projectId: string,
  rollback: RegenerateRollback,
) {
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

async function readJson<T>(response: Response): Promise<T> {
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

function replaceProject(projects: Project[], nextProject: Project) {
  return projects.map((project) =>
    project.id === nextProject.id ? nextProject : project,
  );
}

function nodePositionKey(projectId: string, nodeId: string) {
  return `${projectId}:${nodeId}`;
}

function positionsEqual(left: NodePosition, right: NodePosition) {
  return left.x === right.x && left.y === right.y;
}

function newestTimestamp(left: string, right?: string) {
  return right && right > left ? right : left;
}

function upsertProject(projects: Project[], nextProject: Project) {
  const exists = projects.some((project) => project.id === nextProject.id);
  if (!exists) return [nextProject, ...projects];
  return replaceProject(projects, nextProject);
}

function getActiveProject(projects: Project[], activeProjectId: string | null) {
  return projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
}

function getSelectedNodeId(project: Project | null, selectedNodeId: string | null) {
  if (!project) return null;
  return selectedNodeId && project.nodes[selectedNodeId]
    ? selectedNodeId
    : project.rootNodeId;
}

function isProjectWaitingForSync(state: BranchMindState, projectId: string) {
  const record = state.pendingProjectSyncs[projectId];
  return Boolean(record && record.status !== "synced");
}

function isNodePosition(value: unknown): value is NodePosition {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as NodePosition).x === "number" &&
    typeof (value as NodePosition).y === "number" &&
    Number.isFinite((value as NodePosition).x) &&
    Number.isFinite((value as NodePosition).y)
  );
}

function isPendingNodePositionSyncRecord(
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

function readPendingNodePositionSyncRecords() {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(PENDING_NODE_POSITION_SYNC_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as StoredPendingNodePositionSyncs;
    return Array.isArray(parsed.records)
      ? parsed.records.filter(isPendingNodePositionSyncRecord)
      : [];
  } catch {
    return [];
  }
}

function writePendingNodePositionSyncRecords(
  records: PendingNodePositionSyncRecord[],
) {
  if (typeof window === "undefined") return;

  const payload: StoredPendingNodePositionSyncs = {
    version: 1,
    records,
  };
  window.localStorage.setItem(PENDING_NODE_POSITION_SYNC_KEY, JSON.stringify(payload));
}

function persistPendingNodePositionSyncRecord(record: PendingNodePositionSyncRecord) {
  try {
    const records = readPendingNodePositionSyncRecords();
    writePendingNodePositionSyncRecords([
      record,
      ...records.filter(
        (item) => item.projectId !== record.projectId || item.nodeId !== record.nodeId,
      ),
    ]);
  } catch {
    // Drag state still lives in memory; storage is a resilience layer for reloads.
  }
}

function clearPendingNodePositionSyncRecord(projectId: string, nodeId: string) {
  try {
    writePendingNodePositionSyncRecords(
      readPendingNodePositionSyncRecords().filter(
        (record) => record.projectId !== projectId || record.nodeId !== nodeId,
      ),
    );
  } catch {
    // A stale record is harmless; hydrate drops it once the server is newer.
  }
}

function reconcilePendingNodePositionSyncRecords(
  records: PendingNodePositionSyncRecord[],
) {
  try {
    writePendingNodePositionSyncRecords(records);
  } catch {
    // Keep going; the in-memory project state has already been reconciled.
  }
}

function getPendingSyncMap(records: PendingProjectSyncRecord[]) {
  return Object.fromEntries(
    records.map((record) => [record.project.id, record]),
  ) as Record<string, PendingProjectSyncRecord>;
}

function mergePendingProjects(
  projects: Project[],
  records: PendingProjectSyncRecord[],
) {
  const projectIds = new Set(projects.map((project) => project.id));
  const localOnlyProjects = records
    .filter((record) => !projectIds.has(record.project.id))
    .map((record) => record.project);

  return [...localOnlyProjects, ...projects];
}

function persistPendingSyncRecord(record: PendingProjectSyncRecord) {
  try {
    upsertPendingProjectSyncRecord(record);
    return true;
  } catch {
    return false;
  }
}

function clearPendingSyncRecord(projectId: string) {
  try {
    removePendingProjectSyncRecord(projectId);
  } catch {
    // The server is the source of truth after streaming completes.
  }
}

function clearPendingProjectSyncLocally(
  set: BranchMindSet,
  projectId: string,
) {
  clearPendingSyncRecord(projectId);
  set((current) => {
    const nextPendingSyncs = { ...current.pendingProjectSyncs };
    delete nextPendingSyncs[projectId];
    return {
      pendingProjectSyncs: nextPendingSyncs,
      pendingInitialProjectStream:
        current.pendingInitialProjectStream?.projectId === projectId
          ? null
          : current.pendingInitialProjectStream,
    };
  });
}

function removeProjectLocally(
  set: BranchMindSet,
  get: BranchMindGet,
  projectId: string,
) {
  const nextProjects = get().projects.filter((project) => project.id !== projectId);
  const activeProject = getActiveProject(nextProjects, get().activeProjectId);

  set({
    projects: nextProjects,
    activeProjectId: activeProject?.id ?? null,
    selectedNodeId: getSelectedNodeId(activeProject, get().selectedNodeId),
    aiError: null,
  });
}

type BranchMindSet = StoreApi<BranchMindState>["setState"];
type BranchMindGet = StoreApi<BranchMindState>["getState"];

function applyPendingNodePositionSyncRecords(
  projects: Project[],
  records: PendingNodePositionSyncRecord[],
) {
  let nextProjects = projects;
  const pendingRecords: PendingNodePositionSyncRecord[] = [];

  for (const record of records) {
    const project = nextProjects.find((item) => item.id === record.projectId);
    const node = project?.nodes[record.nodeId];
    if (!project || !node) continue;

    if (record.updatedAt <= node.updatedAt) continue;

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

function mergeConfirmedNodePosition(
  set: BranchMindSet,
  pending: PendingNodePositionSync,
  data: UpdateNodeResponse,
) {
  const positionKey = nodePositionKey(pending.projectId, pending.nodeId);
  if (pendingNodePositionVersions.get(positionKey) !== pending.version) return;

  set((current) => {
    const currentProject = current.projects.find((item) => item.id === pending.projectId);
    const currentNode = currentProject?.nodes[pending.nodeId];
    const serverNode = data.project.nodes[pending.nodeId];
    if (!currentProject || !currentNode) return current;

    const confirmedPosition = positionsEqual(currentNode.position, pending.position)
      ? (serverNode?.position ?? pending.position)
      : currentNode.position;
    const nextProject = {
      ...currentProject,
      updatedAt: newestTimestamp(currentProject.updatedAt, data.project.updatedAt),
      nodes: {
        ...currentProject.nodes,
        [pending.nodeId]: {
          ...currentNode,
          position: confirmedPosition,
          updatedAt: newestTimestamp(currentNode.updatedAt, serverNode?.updatedAt),
        },
      },
    };

    return {
      projects: replaceProject(current.projects, nextProject),
      aiError: null,
    };
  });

  clearPendingNodePositionSyncRecord(pending.projectId, pending.nodeId);
  pendingNodePositionVersions.delete(positionKey);
}

async function flushPendingNodePositionSync(
  set: BranchMindSet,
  key: string,
  options: { keepalive?: boolean; reportErrors?: boolean } = {},
) {
  const pending = pendingNodePositionSyncs.get(key);
  if (!pending) return;

  if (pending.timer) clearTimeout(pending.timer);
  pendingNodePositionSyncs.delete(key);

  try {
    const response = await fetch(
      `/api/projects/${pending.projectId}/nodes/${pending.nodeId}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: pending.position }),
        keepalive: options.keepalive,
      },
    );
    const data = await readJson<UpdateNodeResponse>(response);
    mergeConfirmedNodePosition(set, pending, data);
  } catch (error) {
    if (
      options.reportErrors !== false &&
      pendingNodePositionVersions.get(key) === pending.version
    ) {
      set({ aiError: getErrorMessage(error) });
      const timer = setTimeout(() => {
        void flushPendingNodePositionSync(set, key);
      }, NODE_POSITION_SYNC_RETRY_DELAY_MS);
      pendingNodePositionSyncs.set(key, {
        ...pending,
        timer,
      });
    }
  }
}

function flushPendingNodePositionSyncs(
  set: BranchMindSet,
  options: { keepalive?: boolean; reportErrors?: boolean } = {},
) {
  for (const key of Array.from(pendingNodePositionSyncs.keys())) {
    void flushPendingNodePositionSync(set, key, options);
  }
}

function installNodePositionFlushListeners(set: BranchMindSet) {
  if (
    nodePositionFlushListenersInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  nodePositionFlushListenersInstalled = true;
  const flushForPageExit = () => {
    flushPendingNodePositionSyncs(set, {
      keepalive: true,
      reportErrors: false,
    });
  };

  window.addEventListener("pagehide", flushForPageExit);
  window.addEventListener("beforeunload", flushForPageExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushForPageExit();
  });
}

function queueNodePositionSync(
  set: BranchMindSet,
  record: PendingNodePositionSyncRecord,
  options: { delayMs?: number; version?: number } = {},
) {
  installNodePositionFlushListeners(set);

  const key = nodePositionKey(record.projectId, record.nodeId);
  const existing = pendingNodePositionSyncs.get(key);
  if (existing?.timer) clearTimeout(existing.timer);

  const version = options.version ?? ++nextNodePositionVersion;
  pendingNodePositionVersions.set(key, version);

  const delayMs = options.delayMs ?? NODE_POSITION_SYNC_DELAY_MS;
  const timer = setTimeout(() => {
    void flushPendingNodePositionSync(set, key);
  }, delayMs);

  pendingNodePositionSyncs.set(key, {
    ...record,
    version,
    timer,
  });
}

function getProjectPendingStream(
  state: BranchMindState,
  projectId: string,
): PendingInitialProjectStream | null {
  if (state.pendingInitialProjectStream?.projectId === projectId) {
    return state.pendingInitialProjectStream;
  }

  const syncRecord = state.pendingProjectSyncs[projectId];
  if (!syncRecord || syncRecord.status !== "synced") return null;

  return {
    projectId,
    nodeId: syncRecord.nodeId,
    assistantMessageId: syncRecord.assistantMessageId,
    modelSelection: syncRecord.modelSelection,
    skill: syncRecord.skill,
  };
}

function setPendingSyncRecord(
  set: BranchMindSet,
  record: PendingProjectSyncRecord,
) {
  persistPendingSyncRecord(record);
  set((current) => ({
    pendingProjectSyncs: {
      ...current.pendingProjectSyncs,
      [record.project.id]: record,
    },
  }));
}

function syncPendingProject(
  set: BranchMindSet,
  get: BranchMindGet,
  projectId: string,
) {
  if (inFlightProjectSyncs.has(projectId)) return;

  const record = get().pendingProjectSyncs[projectId];
  if (!record || record.status === "synced") {
    if (record?.status === "synced") get().startPendingInitialProjectStream(projectId);
    return;
  }

  inFlightProjectSyncs.add(projectId);
  const syncingRecord: PendingProjectSyncRecord = {
    ...record,
    status: "syncing",
    error: null,
    updatedAt: new Date().toISOString(),
  };
  setPendingSyncRecord(set, syncingRecord);

  void (async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/sync`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: syncingRecord.project }),
      });
      const data = await readJson<SyncProjectResponse>(response);
      const syncedRecord: PendingProjectSyncRecord = {
        ...syncingRecord,
        project: data.project,
        status: "synced",
        error: null,
        updatedAt: new Date().toISOString(),
      };

      set((current) => ({
        projects: upsertProject(current.projects, data.project),
        pendingProjectSyncs: {
          ...current.pendingProjectSyncs,
          [projectId]: syncedRecord,
        },
        pendingInitialProjectStream: {
          projectId,
          nodeId: syncedRecord.nodeId,
          assistantMessageId: syncedRecord.assistantMessageId,
          modelSelection: syncedRecord.modelSelection,
        },
        aiError: null,
      }));
      persistPendingSyncRecord(syncedRecord);
      get().startPendingInitialProjectStream(projectId);
    } catch (error) {
      const failedRecord: PendingProjectSyncRecord = {
        ...syncingRecord,
        status: "failed",
        error: getErrorMessage(error),
        updatedAt: new Date().toISOString(),
      };

      set((current) => ({
        pendingProjectSyncs: {
          ...current.pendingProjectSyncs,
          [projectId]: failedRecord,
        },
        aiError: current.activeProjectId === projectId ? failedRecord.error : current.aiError,
      }));
      persistPendingSyncRecord(failedRecord);
    } finally {
      inFlightProjectSyncs.delete(projectId);
    }
  })();
}

async function regenerateNodeInPlace(
  set: BranchMindSet,
  get: BranchMindGet,
  {
    nodeId,
    instruction,
    userMessageId,
    assistantMessageId,
    modelSelection,
    skill,
  }: {
    nodeId: string;
    instruction?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    modelSelection?: ChatModelSelection;
    skill?: ChatSkill;
  },
) {
  const state = get();
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  const node = project?.nodes[nodeId];
  if (
    !project ||
    !node ||
    state.creatingNodeId ||
    state.streamingNodeId ||
    isProjectWaitingForSync(state, project.id)
  ) {
    return false;
  }

  const draft = createRegeneratingNodeProject(project, nodeId, {
    instruction,
    userMessageId,
    assistantMessageId,
  });
  if (!draft) return false;

  const rollback: RegenerateRollback = {
    nodeId,
    userMessage: userMessageId
      ? node.messages.find((message) => message.id === userMessageId)
      : undefined,
    assistantMessage: node.messages.find(
      (message) => message.id === draft.assistantMessageId,
    ),
    title: draft.project.title === project.title ? undefined : project.title,
  };

  set({
    projects: replaceProject(state.projects, draft.project),
    selectedNodeId: nodeId,
    creatingNodeId: nodeId,
    streamingNodeId: nodeId,
    streamingMessageId: draft.assistantMessageId,
    aiError: null,
  });

  const deltaBatch = createTextDeltaBatch((contentDelta) => {
    set((current) => {
      const currentProject = current.projects.find((item) => item.id === project.id);
      if (!currentProject) return current;

      return {
        projects: replaceProject(
          current.projects,
          appendDraftAssistantDelta(
            currentProject,
            nodeId,
            draft.assistantMessageId,
            contentDelta,
          ),
        ),
      };
    });
  });

  void (async () => {
    let completed = false;

    try {
      const response = await fetch(
        `/api/projects/${project.id}/nodes/${nodeId}/regenerate`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction,
            userMessageId,
            assistantMessageId: draft.assistantMessageId,
            expectedNodeUpdatedAt: node.updatedAt,
            modelSelection,
            ...(skill ? { skill } : {}),
          }),
        },
      );

      await readNodeStreamingEvents(response, (event) => {
        if (event.type === "delta") {
          deltaBatch.push(event.contentDelta);
          return;
        }

        completed = true;
        deltaBatch.flushNow();
        const pendingSync = get().pendingProjectSyncs[event.project.id];
        if (
          pendingSync?.nodeId === nodeId &&
          pendingSync.assistantMessageId === draft.assistantMessageId
        ) {
          clearPendingSyncRecord(event.project.id);
        }
        set((current) => {
          const currentProject = current.projects.find(
            (item) => item.id === event.project.id,
          );
          const nextProjects = currentProject
            ? replaceProject(current.projects, {
                ...currentProject,
                title: event.project.title,
                updatedAt: newestTimestamp(
                  currentProject.updatedAt,
                  event.project.updatedAt,
                ),
                nodes: {
                  ...currentProject.nodes,
                  [event.node.id]: event.node,
                },
              })
            : replaceProject(current.projects, event.project);

          return {
            projects: nextProjects,
            selectedNodeId: event.node.id,
            creatingNodeId: null,
            streamingNodeId: null,
            streamingMessageId: null,
            pendingProjectSyncs:
              pendingSync?.nodeId === nodeId &&
              pendingSync.assistantMessageId === draft.assistantMessageId
                ? Object.fromEntries(
                    Object.entries(current.pendingProjectSyncs).filter(
                      ([pendingProjectId]) => pendingProjectId !== event.project.id,
                    ),
                  )
                : current.pendingProjectSyncs,
          };
        });
      });

      if (!completed) {
        throw new Error("Streaming response ended before completion.");
      }
    } catch (error) {
      deltaBatch.cancel();
      const errorMessage = isNodeConflictError(error)
        ? getNodeConflictErrorMessage()
        : getErrorMessage(error);
      const currentPendingSync = get().pendingProjectSyncs[project.id];
      const failedPendingSync =
        !completed &&
        currentPendingSync?.nodeId === nodeId &&
        currentPendingSync.assistantMessageId === draft.assistantMessageId
          ? {
              ...currentPendingSync,
              status: "failed" as const,
              error: errorMessage,
              updatedAt: new Date().toISOString(),
            }
          : null;

      if (failedPendingSync) {
        persistPendingSyncRecord(failedPendingSync);
      }

      set((current) => ({
        projects: completed
          ? current.projects
          : rollbackRegeneratedMessages(current.projects, project.id, rollback),
        selectedNodeId: nodeId,
        creatingNodeId: null,
        streamingNodeId: null,
        streamingMessageId: null,
        pendingProjectSyncs: failedPendingSync
          ? {
              ...current.pendingProjectSyncs,
              [project.id]: failedPendingSync,
            }
          : current.pendingProjectSyncs,
        aiError: errorMessage,
      }));
    }
  })();

  return true;
}

async function populateBlankNodeInPlace(
  set: BranchMindSet,
  get: BranchMindGet,
  {
    nodeId,
    instruction,
    attachments = [],
    modelSelection,
    skill,
  }: {
    nodeId: string;
    instruction: string;
    attachments?: ChatAttachment[];
    modelSelection?: ChatModelSelection;
    skill?: ChatSkill;
  },
) {
  const trimmed = instruction.trim();
  if (!trimmed) return false;

  const state = get();
  const project = state.projects.find((item) => item.id === state.activeProjectId);
  const node = project?.nodes[nodeId];
  if (
    !project ||
    !node ||
    node.messages.length > 0 ||
    state.creatingNodeId ||
    state.streamingNodeId ||
    isProjectWaitingForSync(state, project.id)
  ) {
    return false;
  }

  const draft = createPopulatingBlankNodeProject(
    project,
    nodeId,
    trimmed,
    attachments,
  );
  if (!draft) return false;

  set({
    projects: replaceProject(state.projects, draft.project),
    selectedNodeId: nodeId,
    creatingNodeId: nodeId,
    streamingNodeId: nodeId,
    streamingMessageId: draft.assistantMessageId,
    aiError: null,
  });

  const deltaBatch = createTextDeltaBatch((contentDelta) => {
    set((current) => {
      const currentProject = current.projects.find((item) => item.id === project.id);
      if (!currentProject) return current;

      return {
        projects: replaceProject(
          current.projects,
          appendDraftAssistantDelta(
            currentProject,
            nodeId,
            draft.assistantMessageId,
            contentDelta,
          ),
        ),
      };
    });
  });

  void (async () => {
    let completed = false;

    try {
      const response = await fetch(
        `/api/projects/${project.id}/nodes/${nodeId}/populate`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: trimmed,
            attachments,
            modelSelection,
            ...(skill ? { skill } : {}),
          }),
        },
      );

      await readNodeStreamingEvents(response, (event) => {
        if (event.type === "delta") {
          deltaBatch.push(event.contentDelta);
          return;
        }

        completed = true;
        deltaBatch.flushNow();
        set({
          projects: replaceProject(get().projects, event.project),
          selectedNodeId: event.node.id,
          creatingNodeId: null,
          streamingNodeId: null,
          streamingMessageId: null,
        });
      });

      if (!completed) {
        throw new Error("Streaming response ended before completion.");
      }
    } catch (error) {
      deltaBatch.cancel();
      set((current) => ({
        projects: completed ? current.projects : replaceProject(current.projects, project),
        selectedNodeId: nodeId,
        creatingNodeId: null,
        streamingNodeId: null,
        streamingMessageId: null,
        aiError: getErrorMessage(error),
      }));
    }
  })();

  return true;
}

function readLegacyProjects() {
  if (typeof window === "undefined") return { projects: [], activeProjectId: null };

  const activeProjectId = window.localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY);
  const rawProjects = window.localStorage.getItem(LEGACY_PROJECTS_KEY);
  if (!rawProjects) return { projects: [], activeProjectId };

  try {
    const projects = JSON.parse(rawProjects) as Project[];
    return { projects: Array.isArray(projects) ? projects : [], activeProjectId };
  } catch {
    return { projects: [], activeProjectId };
  }
}

function clearLegacyProjects() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_PROJECTS_KEY);
  window.localStorage.removeItem(LEGACY_ACTIVE_PROJECT_KEY);
}

async function loadProjects() {
  const legacy = readLegacyProjects();
  const pendingSyncRecords = readPendingProjectSyncRecords();
  const pendingNodePositionRecords = readPendingNodePositionSyncRecords();

  if (legacy.projects.length > 0) {
    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: legacy.projects }),
    });
    const data = await readJson<ProjectsResponse>(response);

    clearLegacyProjects();
    const nodePositions = applyPendingNodePositionSyncRecords(
      mergePendingProjects(data.projects, pendingSyncRecords),
      pendingNodePositionRecords,
    );
    reconcilePendingNodePositionSyncRecords(nodePositions.pendingRecords);
    return {
      projects: nodePositions.projects,
      preferredProjectId: legacy.activeProjectId,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
      pendingNodePositions: nodePositions.pendingRecords,
      warning: null,
    };
  }

  try {
    const response = await fetch("/api/projects");
    const data = await readJson<ProjectsResponse>(response);
    const nodePositions = applyPendingNodePositionSyncRecords(
      mergePendingProjects(data.projects, pendingSyncRecords),
      pendingNodePositionRecords,
    );
    reconcilePendingNodePositionSyncRecords(nodePositions.pendingRecords);
    return {
      projects: nodePositions.projects,
      preferredProjectId: null,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
      pendingNodePositions: nodePositions.pendingRecords,
      warning: null,
    };
  } catch (error) {
    if (pendingSyncRecords.length === 0) throw error;

    const nodePositions = applyPendingNodePositionSyncRecords(
      pendingSyncRecords.map((record) => record.project),
      pendingNodePositionRecords,
    );
    reconcilePendingNodePositionSyncRecords(nodePositions.pendingRecords);
    return {
      projects: nodePositions.projects,
      preferredProjectId: null,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
      pendingNodePositions: nodePositions.pendingRecords,
      warning: getErrorMessage(error),
    };
  }
}

export const useBranchMindStore = create<BranchMindState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  selectedNodeId: null,
  hydrated: false,
  creatingProject: false,
  creatingNodeId: null,
  streamingNodeId: null,
  streamingMessageId: null,
  pendingInitialProjectStream: null,
  pendingProjectSyncs: {},
  aiError: null,

  hydrate: async (options = {}) => {
    const force = options.force === true;
    if (typeof window === "undefined" || (get().hydrated && !force)) return;

    try {
      const {
        projects,
        preferredProjectId,
        pendingProjectSyncs,
        pendingNodePositions,
        warning,
      } =
        await loadProjects();
      if (get().hydrated && !force) return;

      const state = get();
      const activeProject = getActiveProject(
        projects,
        state.activeProjectId ?? preferredProjectId,
      );

      set({
        projects,
        activeProjectId: activeProject?.id ?? null,
        selectedNodeId: getSelectedNodeId(activeProject, state.selectedNodeId),
        pendingProjectSyncs,
        hydrated: true,
        aiError: warning,
      });

      Object.values(pendingProjectSyncs)
        .filter((record) => record.status === "syncing")
        .forEach((record) => syncPendingProject(set, get, record.project.id));

      pendingNodePositions.forEach((record) => {
        queueNodePositionSync(set, record, { delayMs: 0 });
      });
    } catch (error) {
      set({
        hydrated: true,
        aiError: getErrorMessage(error),
      });
    }
  },

  clearAiError: () => set({ aiError: null }),

  createProject: async (topic, attachments = [], modelSelection, skill) => {
    const trimmed = topic.trim();
    if (!trimmed || get().creatingProject) return null;

    set({ creatingProject: true, aiError: null });

    const pendingRecord = createPendingProjectSyncRecord(
      trimmed,
      attachments,
      modelSelection,
      skill,
    );

    if (persistPendingSyncRecord(pendingRecord)) {
      set((current) => ({
        projects: upsertProject(current.projects, pendingRecord.project),
        activeProjectId: pendingRecord.project.id,
        selectedNodeId: pendingRecord.nodeId,
        creatingProject: false,
        hydrated: true,
        pendingProjectSyncs: {
          ...current.pendingProjectSyncs,
          [pendingRecord.project.id]: pendingRecord,
        },
        pendingInitialProjectStream: null,
      }));

      syncPendingProject(set, get, pendingRecord.project.id);
      return pendingRecord.project.id;
    }

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: trimmed,
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(modelSelection ? { modelSelection } : {}),
          ...(skill ? { skill } : {}),
        }),
      });
      const data = await readJson<CreateProjectResponse>(response);

      set({
        projects: data.projects,
        activeProjectId: data.project.id,
        selectedNodeId: data.project.rootNodeId,
        creatingProject: false,
        hydrated: true,
        pendingInitialProjectStream: data.initialStream
          ? {
              projectId: data.project.id,
              nodeId: data.initialStream.nodeId,
              assistantMessageId: data.initialStream.assistantMessageId,
              modelSelection,
              skill,
            }
          : null,
      });

      return data.project.id;
    } catch (error) {
      set({ creatingProject: false, aiError: getErrorMessage(error) });
      return null;
    }
  },

  startPendingInitialProjectStream: (projectId) => {
    const state = get();
    const pending = getProjectPendingStream(state, projectId);
    if (
      !pending ||
      state.creatingNodeId ||
      state.streamingNodeId
    ) {
      return;
    }

    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;

    set({
      activeProjectId: projectId,
      selectedNodeId: pending.nodeId,
      pendingInitialProjectStream: null,
    });

    void regenerateNodeInPlace(set, get, {
      nodeId: pending.nodeId,
      assistantMessageId: pending.assistantMessageId,
      modelSelection: pending.modelSelection,
      skill: pending.skill,
    }).then((started) => {
      if (started) return;

      const currentPendingSync = get().pendingProjectSyncs[projectId];
      const errorMessage = "Project messages are missing. Retry syncing this project.";
      if (
        currentPendingSync?.nodeId !== pending.nodeId ||
        currentPendingSync.assistantMessageId !== pending.assistantMessageId
      ) {
        set({ aiError: errorMessage });
        return;
      }

      const failedRecord: PendingProjectSyncRecord = {
        ...currentPendingSync,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      };
      persistPendingSyncRecord(failedRecord);
      set((current) => ({
        pendingProjectSyncs: {
          ...current.pendingProjectSyncs,
          [projectId]: failedRecord,
        },
        aiError: errorMessage,
      }));
    });
  },

  retryPendingProjectSync: (projectId) => {
    syncPendingProject(set, get, projectId);
  },

  deleteProject: async (projectId) => {
    const pendingSync = get().pendingProjectSyncs[projectId];
    if (pendingSync && pendingSync.status !== "synced") {
      clearPendingProjectSyncLocally(set, projectId);
      removeProjectLocally(set, get, projectId);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await readJson<ProjectsResponse>(response);
      if (pendingSync) clearPendingSyncRecord(projectId);

      set((current) => {
        const activeProject = getActiveProject(data.projects, current.activeProjectId);
        const nextPendingSyncs = pendingSync
          ? Object.fromEntries(
              Object.entries(current.pendingProjectSyncs).filter(
                ([pendingProjectId]) => pendingProjectId !== projectId,
              ),
            )
          : current.pendingProjectSyncs;

        return {
          projects: data.projects,
          activeProjectId: activeProject?.id ?? null,
          selectedNodeId: getSelectedNodeId(activeProject, current.selectedNodeId),
          pendingProjectSyncs: nextPendingSyncs,
          pendingInitialProjectStream:
            current.pendingInitialProjectStream?.projectId === projectId
              ? null
              : current.pendingInitialProjectStream,
        };
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        if (pendingSync) clearPendingProjectSyncLocally(set, projectId);
        removeProjectLocally(set, get, projectId);
        return;
      }

      set({ aiError: getErrorMessage(error) });
    }
  },

  selectProject: (projectId) => {
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) return;

    set({ activeProjectId: projectId, selectedNodeId: project.rootNodeId });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  createChildNode: async (
    parentId,
    mode,
    instruction,
    sourceText,
    attachments = [],
    modelSelection,
    skill,
  ) => {
    const state = get();
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    const parent = project?.nodes[parentId];
    const trimmed = instruction.trim();
    if (
      !project ||
      !parent ||
      !trimmed ||
      state.creatingNodeId ||
      state.streamingNodeId ||
      isProjectWaitingForSync(state, project.id)
    ) {
      return null;
    }

    const draft = createDraftChildProject(project, parentId, mode, trimmed, attachments);
    if (!draft) return null;

    set({
      projects: replaceProject(state.projects, draft.project),
      selectedNodeId: draft.node.id,
      creatingNodeId: parentId,
      streamingNodeId: draft.node.id,
      streamingMessageId: draft.assistantMessageId,
      aiError: null,
    });

    const deltaBatch = createTextDeltaBatch((contentDelta) => {
      set((current) => {
        const currentProject = current.projects.find((item) => item.id === project.id);
        if (!currentProject) return current;

        return {
          projects: replaceProject(
            current.projects,
            appendDraftAssistantDelta(
              currentProject,
              draft.node.id,
              draft.assistantMessageId,
              contentDelta,
            ),
          ),
        };
      });
    });

    void (async () => {
      let completed = false;

      try {
        const response = await fetch(`/api/projects/${project.id}/nodes/stream`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId,
            mode,
            instruction: trimmed,
            sourceText,
            attachments,
            modelSelection,
            ...(skill ? { skill } : {}),
          }),
        });

        await readNodeStreamingEvents(response, (event) => {
          if (event.type === "delta") {
            deltaBatch.push(event.contentDelta);
            return;
          }

          completed = true;
          deltaBatch.flushNow();
          set({
            projects: replaceProject(get().projects, event.project),
            selectedNodeId: event.node.id,
            creatingNodeId: null,
            streamingNodeId: null,
            streamingMessageId: null,
          });
        });

        if (!completed) {
          throw new Error("Streaming response ended before completion.");
        }
      } catch (error) {
        deltaBatch.cancel();
        if (completed) {
          set({
            creatingNodeId: null,
            streamingNodeId: null,
            streamingMessageId: null,
            aiError: getErrorMessage(error),
          });
          return;
        }

        set((current) => {
          const currentProject = current.projects.find((item) => item.id === project.id);
          return {
            projects: currentProject
              ? replaceProject(
                  current.projects,
                  removeDraftChildNode(currentProject, draft.node.id),
                )
              : current.projects,
            selectedNodeId:
              current.selectedNodeId === draft.node.id ? parentId : current.selectedNodeId,
            creatingNodeId: null,
            streamingNodeId: null,
            streamingMessageId: null,
            aiError: getErrorMessage(error),
          };
        });
      }
    })();

    return draft.node.id;
  },

  createBlankChildNode: (parentId, mode) => {
    const state = get();
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    const parent = project?.nodes[parentId];
    if (
      !project ||
      !parent ||
      state.creatingNodeId ||
      state.streamingNodeId ||
      isProjectWaitingForSync(state, project.id)
    ) {
      return null;
    }

    const draft = createBlankChildProject(project, parentId, mode);
    if (!draft) return null;

    set({
      projects: replaceProject(state.projects, draft.project),
      selectedNodeId: draft.node.id,
      creatingNodeId: parentId,
      streamingMessageId: null,
      aiError: null,
    });

    const persisted = (async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}/nodes`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId,
            mode,
            blank: true,
            nodeId: draft.node.id,
          }),
        });
        const data = await readJson<UpdateNodeResponse>(response);
        const selectedNodeId = data.node?.id ?? draft.node.id;

        set({
          projects: replaceProject(get().projects, data.project),
          selectedNodeId,
          creatingNodeId: null,
          streamingMessageId: null,
        });
        return selectedNodeId;
      } catch (error) {
        set((current) => ({
          projects: replaceProject(current.projects, project),
          selectedNodeId:
            current.selectedNodeId === draft.node.id ? parentId : current.selectedNodeId,
          creatingNodeId: null,
          streamingMessageId: null,
          aiError: getErrorMessage(error),
        }));
        return null;
      }
    })();

    return { nodeId: draft.node.id, persisted };
  },

  populateBlankNode: async (nodeId, instruction, attachments, modelSelection, skill) => {
    return populateBlankNodeInPlace(set, get, {
      nodeId,
      instruction,
      attachments,
      modelSelection,
      skill,
    });
  },

  editUserMessage: async (nodeId, userMessageId, instruction, modelSelection, skill) => {
    const trimmed = instruction.trim();
    if (!trimmed) return false;

    return regenerateNodeInPlace(set, get, {
      nodeId,
      instruction: trimmed,
      userMessageId,
      modelSelection,
      skill,
    });
  },

  retryAssistantMessage: async (nodeId, assistantMessageId, modelSelection, skill) => {
    return regenerateNodeInPlace(set, get, {
      nodeId,
      assistantMessageId,
      modelSelection,
      skill,
    });
  },

  updateProjectNotes: async (projectId, notes) => {
    const state = get();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || isProjectWaitingForSync(state, projectId)) return false;

    const timestamp = new Date().toISOString();
    const optimisticProject = {
      ...project,
      notes,
      updatedAt: timestamp,
    };

    set({
      projects: replaceProject(state.projects, optimisticProject),
    });

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await readJson<UpdateProjectResponse>(response);

      set({ projects: replaceProject(get().projects, data.project) });
      return true;
    } catch {
      return false;
    }
  },

  updateProjectTitle: async (projectId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return false;

    const state = get();
    const project = state.projects.find((item) => item.id === projectId);
    if (
      !project ||
      state.creatingNodeId ||
      state.streamingNodeId ||
      isProjectWaitingForSync(state, projectId)
    ) {
      return false;
    }

    const timestamp = new Date().toISOString();
    const optimisticProject = {
      ...project,
      title: trimmed,
      updatedAt: timestamp,
    };

    set({
      projects: replaceProject(state.projects, optimisticProject),
      aiError: null,
    });

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = await readJson<UpdateProjectResponse>(response);

      set({ projects: replaceProject(get().projects, data.project) });
      return true;
    } catch (error) {
      set((current) => ({
        projects: replaceProject(current.projects, project),
        aiError: getErrorMessage(error),
      }));
      return false;
    }
  },

  updateNodeTitle: async (nodeId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return false;

    const state = get();
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    const node = project?.nodes[nodeId];
    if (
      !project ||
      !node ||
      state.creatingNodeId ||
      state.streamingNodeId ||
      isProjectWaitingForSync(state, project.id)
    ) {
      return false;
    }

    const timestamp = new Date().toISOString();
    const optimisticNode = {
      ...node,
      title: trimmed,
      titleManuallyEdited: true,
      updatedAt: timestamp,
    };
    const optimisticProject = {
      ...project,
      title: nodeId === project.rootNodeId ? trimmed : project.title,
      nodes: {
        ...project.nodes,
        [nodeId]: optimisticNode,
      },
      updatedAt: timestamp,
    };

    set({
      projects: replaceProject(state.projects, optimisticProject),
      aiError: null,
    });

    try {
      const response = await fetch(`/api/projects/${project.id}/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = await readJson<UpdateNodeResponse>(response);

      set({ projects: replaceProject(get().projects, data.project) });
      return true;
    } catch (error) {
      set((current) => ({
        projects: replaceProject(current.projects, project),
        aiError: getErrorMessage(error),
      }));
      return false;
    }
  },

  updateNodePosition: async (nodeId, position) => {
    const state = get();
    const projectId = state.activeProjectId;
    if (!projectId) return;
    if (isProjectWaitingForSync(state, projectId)) {
      return;
    }
    const project = state.projects.find((item) => item.id === projectId);
    const node = project?.nodes[nodeId];
    if (!project || !node || positionsEqual(node.position, position)) return;

    const timestamp = new Date().toISOString();
    const optimisticProject = {
      ...project,
      nodes: {
        ...project.nodes,
        [nodeId]: {
          ...node,
          position,
          updatedAt: timestamp,
        },
      },
      updatedAt: timestamp,
    };
    const positionKey = nodePositionKey(projectId, nodeId);
    const positionVersion = ++nextNodePositionVersion;
    pendingNodePositionVersions.set(positionKey, positionVersion);

    set({
      projects: replaceProject(state.projects, optimisticProject),
      aiError: null,
    });

    persistPendingNodePositionSyncRecord({
      projectId,
      nodeId,
      position,
      updatedAt: timestamp,
    });
    queueNodePositionSync(
      set,
      {
        projectId,
        nodeId,
        position,
        updatedAt: timestamp,
      },
      { version: positionVersion },
    );
  },

  toggleNodeCollapsed: async (nodeId) => {
    const state = get();
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    const node = project?.nodes[nodeId];
    if (!project || !node || isProjectWaitingForSync(state, project.id)) return;

    try {
      const response = await fetch(`/api/projects/${project.id}/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed: !node.collapsed }),
      });
      const data = await readJson<UpdateNodeResponse>(response);

      set({ projects: replaceProject(get().projects, data.project) });
    } catch (error) {
      set({ aiError: getErrorMessage(error) });
    }
  },

  deleteNode: async (nodeId) => {
    const state = get();
    const projectId = state.activeProjectId;
    const project = state.projects.find((item) => item.id === projectId);
    if (!projectId || !project) return;
    if (isProjectWaitingForSync(state, projectId)) return;

    const optimisticDelete = removeNodeProject(project, nodeId);
    if (!optimisticDelete) return;

    const selectedNodeId =
      state.selectedNodeId && !optimisticDelete.project.nodes[state.selectedNodeId]
        ? optimisticDelete.parentId
        : state.selectedNodeId;

    set({
      projects: replaceProject(state.projects, optimisticDelete.project),
      selectedNodeId,
      creatingNodeId: null,
      aiError: null,
    });

    try {
      const response = await fetch(`/api/projects/${projectId}/nodes/${nodeId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await readJson<UpdateNodeResponse>(response);

      set({
        projects: replaceProject(get().projects, data.project),
        selectedNodeId: data.selectedNodeId ?? null,
        creatingNodeId: null,
      });
    } catch (error) {
      set({
        projects: replaceProject(get().projects, project),
        selectedNodeId: state.selectedNodeId,
        creatingNodeId: null,
        aiError: getErrorMessage(error),
      });
    }
  },
}));
