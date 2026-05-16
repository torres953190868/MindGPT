"use client";

import { create } from "zustand";
import type { StoreApi } from "zustand";
import {
  appendDraftAssistantDelta,
  createDraftChildProject,
  createRegeneratingNodeProject,
  createTextDeltaBatch,
  readNodeStreamingEvents,
  removeDraftChildNode,
} from "@/lib/client/node-streaming";
import {
  createPendingProjectSyncRecord,
  readPendingProjectSyncRecords,
  removePendingProjectSyncRecord,
  type PendingProjectSyncRecord,
  upsertPendingProjectSyncRecord,
} from "@/lib/client/pending-project-sync";
import type {
  BranchType,
  ChatAttachment,
  ChatModelSelection,
  NodePosition,
  Project,
} from "@/lib/types";

const LEGACY_PROJECTS_KEY = "branchmind.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "branchmind.activeProjectId.v1";

const inFlightProjectSyncs = new Set<string>();

type PendingInitialProjectStream = {
  projectId: string;
  nodeId: string;
  assistantMessageId: string;
  modelSelection?: ChatModelSelection;
};

type BranchMindState = {
  projects: Project[];
  activeProjectId: string | null;
  selectedNodeId: string | null;
  hydrated: boolean;
  creatingProject: boolean;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  pendingInitialProjectStream: PendingInitialProjectStream | null;
  pendingProjectSyncs: Record<string, PendingProjectSyncRecord>;
  aiError: string | null;
  hydrate: (options?: { force?: boolean }) => Promise<void>;
  clearAiError: () => void;
  createProject: (
    topic: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
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
  ) => Promise<string | null>;
  editUserMessage: (
    nodeId: string,
    userMessageId: string,
    instruction: string,
    modelSelection?: ChatModelSelection,
  ) => Promise<boolean>;
  retryAssistantMessage: (
    nodeId: string,
    assistantMessageId: string,
    modelSelection?: ChatModelSelection,
  ) => Promise<boolean>;
  updateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
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
  }: {
    nodeId: string;
    instruction?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    modelSelection?: ChatModelSelection;
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

  set({
    projects: replaceProject(state.projects, draft.project),
    selectedNodeId: nodeId,
    creatingNodeId: nodeId,
    streamingNodeId: nodeId,
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
            assistantMessageId,
            modelSelection,
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
        set({
          projects: replaceProject(get().projects, event.project),
          selectedNodeId: event.node.id,
          creatingNodeId: null,
          streamingNodeId: null,
          pendingProjectSyncs:
            pendingSync?.nodeId === nodeId &&
            pendingSync.assistantMessageId === draft.assistantMessageId
              ? Object.fromEntries(
                  Object.entries(get().pendingProjectSyncs).filter(
                    ([pendingProjectId]) => pendingProjectId !== event.project.id,
                  ),
                )
              : get().pendingProjectSyncs,
        });
      });

      if (!completed) {
        throw new Error("Streaming response ended before completion.");
      }
    } catch (error) {
      deltaBatch.cancel();
      set((current) => ({
        projects: completed
          ? current.projects
          : replaceProject(current.projects, project),
        selectedNodeId: nodeId,
        creatingNodeId: null,
        streamingNodeId: null,
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

  if (legacy.projects.length > 0) {
    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: legacy.projects }),
    });
    const data = await readJson<ProjectsResponse>(response);

    clearLegacyProjects();
    return {
      projects: mergePendingProjects(data.projects, pendingSyncRecords),
      preferredProjectId: legacy.activeProjectId,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
      warning: null,
    };
  }

  try {
    const response = await fetch("/api/projects");
    const data = await readJson<ProjectsResponse>(response);
    return {
      projects: mergePendingProjects(data.projects, pendingSyncRecords),
      preferredProjectId: null,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
      warning: null,
    };
  } catch (error) {
    if (pendingSyncRecords.length === 0) throw error;

    return {
      projects: pendingSyncRecords.map((record) => record.project),
      preferredProjectId: null,
      pendingProjectSyncs: getPendingSyncMap(pendingSyncRecords),
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
  pendingInitialProjectStream: null,
  pendingProjectSyncs: {},
  aiError: null,

  hydrate: async (options = {}) => {
    const force = options.force === true;
    if (typeof window === "undefined" || (get().hydrated && !force)) return;

    try {
      const { projects, preferredProjectId, pendingProjectSyncs, warning } =
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
    } catch (error) {
      set({
        hydrated: true,
        aiError: getErrorMessage(error),
      });
    }
  },

  clearAiError: () => set({ aiError: null }),

  createProject: async (topic, attachments = [], modelSelection) => {
    const trimmed = topic.trim();
    if (!trimmed || get().creatingProject) return null;

    set({ creatingProject: true, aiError: null });

    const pendingRecord = createPendingProjectSyncRecord(
      trimmed,
      attachments,
      modelSelection,
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
    });
  },

  retryPendingProjectSync: (projectId) => {
    syncPendingProject(set, get, projectId);
  },

  deleteProject: async (projectId) => {
    const pendingSync = get().pendingProjectSyncs[projectId];
    if (pendingSync) {
      clearPendingSyncRecord(projectId);
      set((current) => {
        const nextPendingSyncs = { ...current.pendingProjectSyncs };
        delete nextPendingSyncs[projectId];
        return { pendingProjectSyncs: nextPendingSyncs };
      });
      removeProjectLocally(set, get, projectId);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const data = await readJson<ProjectsResponse>(response);
      const activeProject = getActiveProject(data.projects, get().activeProjectId);

      set({
        projects: data.projects,
        activeProjectId: activeProject?.id ?? null,
        selectedNodeId: getSelectedNodeId(activeProject, get().selectedNodeId),
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        removeProjectLocally(set, get, projectId);
        void get().hydrate({ force: true });
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
            aiError: getErrorMessage(error),
          };
        });
      }
    })();

    return draft.node.id;
  },

  editUserMessage: async (nodeId, userMessageId, instruction, modelSelection) => {
    const trimmed = instruction.trim();
    if (!trimmed) return false;

    return regenerateNodeInPlace(set, get, {
      nodeId,
      instruction: trimmed,
      userMessageId,
      modelSelection,
    });
  },

  retryAssistantMessage: async (nodeId, assistantMessageId, modelSelection) => {
    return regenerateNodeInPlace(set, get, {
      nodeId,
      assistantMessageId,
      modelSelection,
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
      aiError: null,
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
    } catch (error) {
      set({ aiError: getErrorMessage(error) });
      return false;
    }
  },

  updateNodePosition: async (nodeId, position) => {
    const state = get();
    const projectId = state.activeProjectId;
    if (!projectId) return;
    if (isProjectWaitingForSync(state, projectId)) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position }),
      });
      const data = await readJson<UpdateNodeResponse>(response);

      set({ projects: replaceProject(get().projects, data.project) });
    } catch (error) {
      set({ aiError: getErrorMessage(error) });
    }
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
    if (!projectId) return;
    if (isProjectWaitingForSync(state, projectId)) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/nodes/${nodeId}`, {
        method: "DELETE",
      });
      const data = await readJson<UpdateNodeResponse>(response);

      set({
        projects: replaceProject(get().projects, data.project),
        selectedNodeId: data.selectedNodeId ?? null,
      });
    } catch (error) {
      set({ aiError: getErrorMessage(error) });
    }
  },
}));
