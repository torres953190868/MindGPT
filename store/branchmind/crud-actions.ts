import { createBlankChildProject, removeNodeProject } from "@/lib/client/node-streaming";
import { createPendingProjectSyncRecord } from "@/lib/client/pending-project-sync";
import {
  getActiveProject,
  getErrorMessage,
  getSelectedNodeId,
  isNotFoundError,
  isProjectWaitingForSync,
  newestTimestamp,
  nodeCollapsedKey,
  positionsEqual,
  readJson,
  replaceProject,
  upsertProject,
} from "./helpers";
import {
  allocateNodePositionVersion,
  clearPendingProjectSyncLocally,
  clearPendingSyncRecord,
  persistPendingNodePositionSyncRecord,
  persistPendingSyncRecord,
  queueNodePositionSync,
  removeProjectLocally,
  syncPendingProject,
} from "./sync";
import type {
  BranchMindCrudActions,
  BranchMindGet,
  BranchMindSet,
  CreateProjectResponse,
  ProjectsResponse,
  UpdateNodeResponse,
  UpdateProjectResponse,
} from "./types";

const inFlightNodeCollapsedUpdates = new Map<string, Promise<void>>();
const pendingNodeCollapsedVersions = new Map<string, number>();
let nextNodeCollapsedVersion = 0;

export function createCrudActions(
  set: BranchMindSet,
  get: BranchMindGet,
): BranchMindCrudActions {
  return {
    createProject: async (topic, attachments = [], modelSelection, skill) => {
      const trimmed = topic.trim();
      if (!trimmed || get().creatingProject) return null;

      set({ creatingProject: true, aiError: null });

      const pendingRecord = createPendingProjectSyncRecord(trimmed, attachments, modelSelection, skill);

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
            body: JSON.stringify({ parentId, mode, blank: true, nodeId: draft.node.id }),
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

    updateProjectNotes: async (projectId, notes) => {
      const state = get();
      const project = state.projects.find((item) => item.id === projectId);
      if (!project || isProjectWaitingForSync(state, projectId)) return false;

      const updatedAt = new Date().toISOString();
      set({ projects: replaceProject(state.projects, { ...project, notes, updatedAt }) });

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

      const updatedAt = new Date().toISOString();
      set({
        projects: replaceProject(state.projects, { ...project, title: trimmed, updatedAt }),
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

      const updatedAt = new Date().toISOString();
      const optimisticNode = { ...node, title: trimmed, titleManuallyEdited: true, updatedAt };
      // Only sync the project title while it is still auto-derived from the root
      // node (i.e. it equals the root node's previous title). A manually renamed
      // project keeps its own title.
      const shouldSyncProjectTitle =
        nodeId === project.rootNodeId && project.title === node.title;
      const optimisticProject = {
        ...project,
        title: shouldSyncProjectTitle ? trimmed : project.title,
        nodes: { ...project.nodes, [nodeId]: optimisticNode },
        updatedAt,
      };

      set({ projects: replaceProject(state.projects, optimisticProject), aiError: null });

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
      if (!projectId || isProjectWaitingForSync(state, projectId)) return;

      const project = state.projects.find((item) => item.id === projectId);
      const node = project?.nodes[nodeId];
      if (!project || !node || positionsEqual(node.position, position)) return;

      const updatedAt = new Date().toISOString();
      const optimisticProject = {
        ...project,
        nodes: { ...project.nodes, [nodeId]: { ...node, position, updatedAt } },
        updatedAt,
      };
      const positionVersion = allocateNodePositionVersion(projectId, nodeId);

      set({ projects: replaceProject(state.projects, optimisticProject), aiError: null });

      const syncRecord = { projectId, nodeId, position, updatedAt };
      persistPendingNodePositionSyncRecord(syncRecord);
      queueNodePositionSync(set, syncRecord, { version: positionVersion });
    },

    toggleNodeCollapsed: async (nodeId) => {
      const state = get();
      const project = state.projects.find((item) => item.id === state.activeProjectId);
      const node = project?.nodes[nodeId];
      if (!project || !node || isProjectWaitingForSync(state, project.id)) return;

      const collapsed = !node.collapsed;
      const updatedAt = new Date().toISOString();
      const optimisticProject = {
        ...project,
        nodes: { ...project.nodes, [nodeId]: { ...node, collapsed, updatedAt } },
        updatedAt,
      };
      const key = nodeCollapsedKey(project.id, nodeId);
      const version = ++nextNodeCollapsedVersion;
      pendingNodeCollapsedVersions.set(key, version);

      set({ projects: replaceProject(state.projects, optimisticProject), aiError: null });

      // Keep writes for one node in order. The UI still changes immediately, while
      // serializing requests prevents a late first response from becoming the saved state.
      const previousRequest = inFlightNodeCollapsedUpdates.get(key) ?? Promise.resolve();
      const request = previousRequest
        .catch(() => undefined)
        .then(async () => {
          try {
            const response = await fetch(`/api/projects/${project.id}/nodes/${nodeId}`, {
              method: "PATCH",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ collapsed }),
            });
            const data = await readJson<UpdateNodeResponse>(response);

            if (pendingNodeCollapsedVersions.get(key) !== version) return;

            set((current) => {
              const currentProject = current.projects.find((item) => item.id === project.id);
              const currentNode = currentProject?.nodes[nodeId];
              const serverNode = data.project.nodes[nodeId];
              if (!currentProject || !currentNode || !serverNode) return current;

              const nextProject = {
                ...currentProject,
                updatedAt: newestTimestamp(currentProject.updatedAt, data.project.updatedAt),
                nodes: {
                  ...currentProject.nodes,
                  [nodeId]: {
                    ...currentNode,
                    collapsed: serverNode.collapsed,
                    updatedAt: newestTimestamp(currentNode.updatedAt, serverNode.updatedAt),
                  },
                },
              };

              return { projects: replaceProject(current.projects, nextProject), aiError: null };
            });
            pendingNodeCollapsedVersions.delete(key);
          } catch (error) {
            if (pendingNodeCollapsedVersions.get(key) !== version) return;

            set((current) => {
              const currentProject = current.projects.find((item) => item.id === project.id);
              const currentNode = currentProject?.nodes[nodeId];
              if (!currentProject || !currentNode) return { aiError: getErrorMessage(error) };

              return {
                projects: replaceProject(current.projects, {
                  ...currentProject,
                  nodes: {
                    ...currentProject.nodes,
                    [nodeId]: { ...currentNode, collapsed: node.collapsed },
                  },
                }),
                aiError: getErrorMessage(error),
              };
            });
            pendingNodeCollapsedVersions.delete(key);
          }
        });

      inFlightNodeCollapsedUpdates.set(key, request);
      void request.finally(() => {
        if (inFlightNodeCollapsedUpdates.get(key) === request) {
          inFlightNodeCollapsedUpdates.delete(key);
        }
      });

      await request;
    },

    deleteNode: async (nodeId) => {
      const state = get();
      const projectId = state.activeProjectId;
      const project = state.projects.find((item) => item.id === projectId);
      if (!projectId || !project || isProjectWaitingForSync(state, projectId)) return;

      const optimisticDelete = removeNodeProject(project, nodeId);
      if (!optimisticDelete) return;

      const selectedNodeId =
        state.selectedNodeId && !optimisticDelete.project.nodes[state.selectedNodeId]
          ? optimisticDelete.parentId
          : state.selectedNodeId;

      set({
        projects: replaceProject(state.projects, optimisticDelete.project),
        selectedNodeId,
        creatingNodeId: nodeId,
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
  };
}
