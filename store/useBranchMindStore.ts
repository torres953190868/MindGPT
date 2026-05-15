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
import type {
  BranchType,
  ChatAttachment,
  ChatModelSelection,
  NodePosition,
  Project,
} from "@/lib/types";

const LEGACY_PROJECTS_KEY = "branchmind.projects.v1";
const LEGACY_ACTIVE_PROJECT_KEY = "branchmind.activeProjectId.v1";

type BranchMindState = {
  projects: Project[];
  activeProjectId: string | null;
  selectedNodeId: string | null;
  hydrated: boolean;
  creatingProject: boolean;
  creatingNodeId: string | null;
  streamingNodeId: string | null;
  aiError: string | null;
  hydrate: () => Promise<void>;
  clearAiError: () => void;
  createProject: (topic: string) => Promise<string | null>;
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
    message?: string;
  };
};

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

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data) ?? "Request failed.");
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

function getActiveProject(projects: Project[], activeProjectId: string | null) {
  return projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
}

type BranchMindSet = StoreApi<BranchMindState>["setState"];
type BranchMindGet = StoreApi<BranchMindState>["getState"];

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
  if (!project || !node || state.creatingNodeId || state.streamingNodeId) {
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

  if (legacy.projects.length > 0) {
    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects: legacy.projects }),
    });
    const data = await readJson<ProjectsResponse>(response);

    clearLegacyProjects();
    return {
      projects: data.projects,
      preferredProjectId: legacy.activeProjectId,
    };
  }

  const response = await fetch("/api/projects");
  const data = await readJson<ProjectsResponse>(response);
  return {
    projects: data.projects,
    preferredProjectId: null,
  };
}

export const useBranchMindStore = create<BranchMindState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  selectedNodeId: null,
  hydrated: false,
  creatingProject: false,
  creatingNodeId: null,
  streamingNodeId: null,
  aiError: null,

  hydrate: async () => {
    if (typeof window === "undefined" || get().hydrated) return;

    try {
      const { projects, preferredProjectId } = await loadProjects();
      if (get().hydrated) return;

      const activeProject = getActiveProject(projects, preferredProjectId);

      set({
        projects,
        activeProjectId: activeProject?.id ?? null,
        selectedNodeId: activeProject?.rootNodeId ?? null,
        hydrated: true,
      });
    } catch (error) {
      set({
        hydrated: true,
        aiError: getErrorMessage(error),
      });
    }
  },

  clearAiError: () => set({ aiError: null }),

  createProject: async (topic) => {
    const trimmed = topic.trim();
    if (!trimmed || get().creatingProject) return null;

    set({ creatingProject: true, aiError: null });

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      const data = await readJson<CreateProjectResponse>(response);

      set({
        projects: data.projects,
        activeProjectId: data.project.id,
        selectedNodeId: data.project.rootNodeId,
        creatingProject: false,
      });

      return data.project.id;
    } catch (error) {
      set({ creatingProject: false, aiError: getErrorMessage(error) });
      return null;
    }
  },

  deleteProject: async (projectId) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const data = await readJson<ProjectsResponse>(response);
      const activeProject = getActiveProject(data.projects, get().activeProjectId);

      set({
        projects: data.projects,
        activeProjectId: activeProject?.id ?? null,
        selectedNodeId: activeProject?.rootNodeId ?? null,
      });
    } catch (error) {
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
    if (!project || !parent || !trimmed || state.creatingNodeId || state.streamingNodeId) {
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
    if (!project) return false;

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
    const projectId = get().activeProjectId;
    if (!projectId) return;

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
    if (!project || !node) return;

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
    const projectId = get().activeProjectId;
    if (!projectId) return;

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
