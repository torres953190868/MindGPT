import { createBlankChildProject, removeNodeProject } from "@/lib/client/node-streaming";
import { createPendingProjectSyncRecord } from "@/lib/client/pending-project-sync";
import type { Project } from "@/lib/types";
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
  reconcileConfirmedNodeDeletion,
  reconcileFailedNodeDeletion,
  replaceProject,
  stripConfirmedDeletedNodes,
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
  BranchMindState,
  CreateProjectResponse,
  ProjectsResponse,
  UpdateNodeResponse,
  UpdateProjectResponse,
} from "./types";

type QueuedNodeDeletion = {
  nodeId: string;
  previousSelectedNodeId: string | null;
  autoSelectedNodeId: string | null;
  resolve: () => void;
  promise: Promise<void>;
};

type ProjectDeletionQueue = {
  projectId: string;
  lastConfirmedProject: Project;
  confirmedDeletedNodeIds: Set<string>;
  inFlight: QueuedNodeDeletion | null;
  pending: QueuedNodeDeletion[];
  processing: boolean;
};

const inFlightNodeCollapsedUpdates = new Map<string, Promise<void>>();
const pendingNodeCollapsedVersions = new Map<string, number>();
let nextNodeCollapsedVersion = 0;

const projectDeletionQueues = new Map<string, ProjectDeletionQueue>();
const activeDeletionLockNodeIds = new Set<string>();

function getQueuedDeletionNodeId(projectId: string | null): string | null {
  if (!projectId) return null;
  const queue = projectDeletionQueues.get(projectId);
  if (!queue) return null;
  if (queue.pending.length > 0) {
    return queue.pending[queue.pending.length - 1].nodeId;
  }
  return queue.inFlight?.nodeId ?? null;
}

function resolveNextDeletionCreatingNodeId(
  current: Pick<
    BranchMindState,
    "activeProjectId" | "creatingNodeId" | "streamingNodeId"
  >,
): string | null {
  if (current.streamingNodeId && current.creatingNodeId) {
    return current.creatingNodeId;
  }
  if (
    current.creatingNodeId !== null &&
    !activeDeletionLockNodeIds.has(current.creatingNodeId)
  ) {
    return current.creatingNodeId;
  }

  const activeQueueNodeId = getQueuedDeletionNodeId(current.activeProjectId);
  if (activeQueueNodeId) {
    activeDeletionLockNodeIds.add(activeQueueNodeId);
    return activeQueueNodeId;
  }

  for (const queue of projectDeletionQueues.values()) {
    const candidate =
      queue.pending.length > 0
        ? queue.pending[queue.pending.length - 1].nodeId
        : (queue.inFlight?.nodeId ?? null);
    if (candidate) {
      activeDeletionLockNodeIds.add(candidate);
      return candidate;
    }
  }

  activeDeletionLockNodeIds.clear();
  return null;
}

async function retrieveAuthoritativeProject(
  projectId: string,
  fallbackProject: Project,
): Promise<{ project: Project; fromServer: boolean }> {
  try {
    const response = await fetch("/api/projects", { credentials: "same-origin" });
    const data = await readJson<ProjectsResponse>(response);
    const serverProject = data.projects.find((item) => item.id === projectId);
    if (!serverProject) {
      return { project: fallbackProject, fromServer: false };
    }
    return { project: serverProject, fromServer: true };
  } catch {
    return { project: fallbackProject, fromServer: false };
  }
}

async function processProjectDeletionQueue(
  set: BranchMindSet,
  get: BranchMindGet,
  queue: ProjectDeletionQueue,
): Promise<void> {
  if (queue.processing) return;
  queue.processing = true;

  try {
    while (queue.pending.length > 0) {
      if (!get().projects.some((item) => item.id === queue.projectId)) {
        const skipped = queue.pending.splice(0, queue.pending.length);
        projectDeletionQueues.delete(queue.projectId);
        set((current) => ({
          creatingNodeId: resolveNextDeletionCreatingNodeId(current),
        }));
        skipped.forEach((op) => op.resolve());
        break;
      }

      const op = queue.pending.shift()!;
      queue.inFlight = op;

      if (!queue.lastConfirmedProject.nodes[op.nodeId]) {
        queue.confirmedDeletedNodeIds.add(op.nodeId);
        queue.inFlight = null;
        if (queue.pending.length === 0) {
          projectDeletionQueues.delete(queue.projectId);
        }
        set((current) => ({
          creatingNodeId: resolveNextDeletionCreatingNodeId(current),
        }));
        op.resolve();
        continue;
      }

      const previousConfirmedProject = queue.lastConfirmedProject;

      try {
        const response = await fetch(
          `/api/projects/${queue.projectId}/nodes/${op.nodeId}`,
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        );
        const data = await readJson<UpdateNodeResponse>(response);

        for (const id of Object.keys(previousConfirmedProject.nodes)) {
          if (!data.project.nodes[id]) {
            queue.confirmedDeletedNodeIds.add(id);
          }
        }
        queue.confirmedDeletedNodeIds.add(op.nodeId);
        queue.lastConfirmedProject = data.project;
        queue.inFlight = null;

        const pendingNodeIds = queue.pending.map((item) => item.nodeId);
        if (queue.pending.length === 0) {
          projectDeletionQueues.delete(queue.projectId);
        }

        set((current) => {
          const currentProject = current.projects.find(
            (item) => item.id === queue.projectId,
          );
          const nextCreatingNodeId = resolveNextDeletionCreatingNodeId(current);
          if (!currentProject) {
            return { creatingNodeId: nextCreatingNodeId };
          }

          const nextProject = reconcileConfirmedNodeDeletion(
            currentProject,
            previousConfirmedProject,
            data.project,
            op.nodeId,
            pendingNodeIds,
          );
          const nextSelectedNodeId =
            current.activeProjectId === queue.projectId
              ? current.selectedNodeId && nextProject.nodes[current.selectedNodeId]
                ? current.selectedNodeId
                : data.selectedNodeId && nextProject.nodes[data.selectedNodeId]
                  ? data.selectedNodeId
                  : nextProject.rootNodeId
              : current.selectedNodeId;

          return {
            projects: replaceProject(current.projects, nextProject),
            selectedNodeId: nextSelectedNodeId,
            creatingNodeId: nextCreatingNodeId,
          };
        });
      } catch (error) {
        const authoritative = await retrieveAuthoritativeProject(
          queue.projectId,
          queue.lastConfirmedProject,
        );
        queue.lastConfirmedProject = stripConfirmedDeletedNodes(
          authoritative.project,
          queue.confirmedDeletedNodeIds,
        );
        const alreadyDeletedOnServer =
          authoritative.fromServer && !queue.lastConfirmedProject.nodes[op.nodeId];
        if (alreadyDeletedOnServer) {
          queue.confirmedDeletedNodeIds.add(op.nodeId);
        }

        queue.inFlight = null;
        const pendingNodeIds = queue.pending.map((item) => item.nodeId);
        if (queue.pending.length === 0) {
          projectDeletionQueues.delete(queue.projectId);
        }

        set((current) => {
          const currentProject = current.projects.find(
            (item) => item.id === queue.projectId,
          );
          const nextCreatingNodeId = resolveNextDeletionCreatingNodeId(current);
          if (!currentProject) {
            return {
              creatingNodeId: nextCreatingNodeId,
              ...(alreadyDeletedOnServer ? {} : { aiError: getErrorMessage(error) }),
            };
          }

          const nextProject = reconcileFailedNodeDeletion(
            currentProject,
            queue.lastConfirmedProject,
            queue.confirmedDeletedNodeIds,
            pendingNodeIds,
          );

          let nextSelectedNodeId = current.selectedNodeId;
          if (current.activeProjectId === queue.projectId) {
            if (
              !alreadyDeletedOnServer &&
              pendingNodeIds.length === 0 &&
              current.selectedNodeId === op.autoSelectedNodeId &&
              op.previousSelectedNodeId &&
              nextProject.nodes[op.previousSelectedNodeId]
            ) {
              nextSelectedNodeId = op.previousSelectedNodeId;
            } else {
              nextSelectedNodeId = getSelectedNodeId(
                nextProject,
                current.selectedNodeId,
              );
            }
          }

          return {
            projects: replaceProject(current.projects, nextProject),
            selectedNodeId: nextSelectedNodeId,
            creatingNodeId: nextCreatingNodeId,
            ...(alreadyDeletedOnServer ? {} : { aiError: getErrorMessage(error) }),
          };
        });
      }

      op.resolve();
    }
  } finally {
    queue.processing = false;
    if (queue.pending.length > 0 && !queue.inFlight) {
      void processProjectDeletionQueue(set, get, queue);
    } else if (!queue.inFlight) {
      projectDeletionQueues.delete(queue.projectId);
    }
  }
}

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

      const existingQueue = projectDeletionQueues.get(projectId);
      if (existingQueue?.inFlight?.nodeId === nodeId) {
        await existingQueue.inFlight.promise;
        return;
      }
      const existingPending = existingQueue?.pending.find(
        (item) => item.nodeId === nodeId,
      );
      if (existingPending) {
        await existingPending.promise;
        return;
      }

      const optimisticDelete = removeNodeProject(project, nodeId);
      const canQueueOptimisticallyRemovedDescendant =
        !optimisticDelete &&
        Boolean(
          existingQueue &&
            existingQueue.lastConfirmedProject.nodes[nodeId] &&
            existingQueue.lastConfirmedProject.nodes[nodeId].parentId !== null &&
            !existingQueue.confirmedDeletedNodeIds.has(nodeId),
        );

      if (!optimisticDelete && !canQueueOptimisticallyRemovedDescendant) return;

      const queue =
        existingQueue ??
        (() => {
          const created: ProjectDeletionQueue = {
            projectId,
            lastConfirmedProject: project,
            confirmedDeletedNodeIds: new Set<string>(),
            inFlight: null,
            pending: [],
            processing: false,
          };
          projectDeletionQueues.set(projectId, created);
          return created;
        })();

      const selectedNodeId = optimisticDelete
        ? state.selectedNodeId && !optimisticDelete.project.nodes[state.selectedNodeId]
          ? optimisticDelete.parentId
          : state.selectedNodeId
        : state.selectedNodeId;

      let resolveOp: () => void = () => {};
      const promise = new Promise<void>((resolve) => {
        resolveOp = resolve;
      });

      queue.pending.push({
        nodeId,
        previousSelectedNodeId: state.selectedNodeId,
        autoSelectedNodeId: selectedNodeId,
        resolve: resolveOp,
        promise,
      });
      activeDeletionLockNodeIds.add(nodeId);

      set({
        ...(optimisticDelete
          ? { projects: replaceProject(state.projects, optimisticDelete.project) }
          : {}),
        selectedNodeId,
        creatingNodeId:
          state.streamingNodeId && state.creatingNodeId
            ? state.creatingNodeId
            : nodeId,
        aiError: null,
      });

      void processProjectDeletionQueue(set, get, queue);
      await promise;
    },
  };
}
