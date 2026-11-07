import {
  appendDraftAssistantDelta,
  createDraftChildProject,
  createPopulatingBlankNodeProject,
  createRegeneratingNodeProject,
  createTextDeltaBatch,
  readNodeStreamingEvents,
  removeDraftChildNode,
} from "@/lib/client/node-streaming";
import type { PendingProjectSyncRecord } from "@/lib/client/pending-project-sync";
import {
  getErrorMessage,
  getNodeConflictErrorMessage,
  isNodeConflictError,
  isProjectWaitingForSync,
  newestTimestamp,
  replaceProject,
  rollbackRegeneratedMessages,
} from "./helpers";
import {
  clearPendingSyncRecord,
  getProjectPendingStream,
  persistPendingSyncRecord,
} from "./sync";
import type {
  BranchMindGet,
  BranchMindSet,
  BranchMindStreamingActions,
  PopulateBlankNodeOptions,
  RegenerateNodeOptions,
  RegenerateRollback,
} from "./types";

export async function regenerateNodeInPlace(
  set: BranchMindSet,
  get: BranchMindGet,
  { nodeId, instruction, userMessageId, assistantMessageId, modelSelection, skill }: RegenerateNodeOptions,
): Promise<boolean> {
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
    assistantMessage: node.messages.find((message) => message.id === draft.assistantMessageId),
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
      const response = await fetch(`/api/projects/${project.id}/nodes/${nodeId}/regenerate`, {
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
      });

      await readNodeStreamingEvents(response, (event) => {
        if (event.type === "delta") {
          deltaBatch.push(event.contentDelta);
          return;
        }

        completed = true;
        deltaBatch.flushNow();
        const pendingSync = get().pendingProjectSyncs[event.project.id];
        const matchesPendingSync =
          pendingSync?.nodeId === nodeId &&
          pendingSync.assistantMessageId === draft.assistantMessageId;
        if (matchesPendingSync) clearPendingSyncRecord(event.project.id);

        set((current) => {
          const currentProject = current.projects.find((item) => item.id === event.project.id);
          const nextProjects = currentProject
            ? replaceProject(current.projects, {
                ...currentProject,
                title: event.project.title,
                updatedAt: newestTimestamp(currentProject.updatedAt, event.project.updatedAt),
                nodes: { ...currentProject.nodes, [event.node.id]: event.node },
              })
            : replaceProject(current.projects, event.project);

          return {
            projects: nextProjects,
            selectedNodeId: event.node.id,
            creatingNodeId: null,
            streamingNodeId: null,
            streamingMessageId: null,
            pendingProjectSyncs: matchesPendingSync
              ? Object.fromEntries(
                  Object.entries(current.pendingProjectSyncs).filter(
                    ([pendingProjectId]) => pendingProjectId !== event.project.id,
                  ),
                )
              : current.pendingProjectSyncs,
          };
        });
      });

      if (!completed) throw new Error("Streaming response ended before completion.");
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

      if (failedPendingSync) persistPendingSyncRecord(failedPendingSync);

      set((current) => ({
        projects: completed
          ? current.projects
          : rollbackRegeneratedMessages(current.projects, project.id, rollback),
        selectedNodeId: nodeId,
        creatingNodeId: null,
        streamingNodeId: null,
        streamingMessageId: null,
        pendingProjectSyncs: failedPendingSync
          ? { ...current.pendingProjectSyncs, [project.id]: failedPendingSync }
          : current.pendingProjectSyncs,
        aiError: errorMessage,
      }));
    }
  })();

  return true;
}

export async function populateBlankNodeInPlace(
  set: BranchMindSet,
  get: BranchMindGet,
  { nodeId, instruction, attachments = [], modelSelection, skill }: PopulateBlankNodeOptions,
): Promise<boolean> {
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

  const draft = createPopulatingBlankNodeProject(project, nodeId, trimmed, attachments);
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
      const response = await fetch(`/api/projects/${project.id}/nodes/${nodeId}/populate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: trimmed,
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

      if (!completed) throw new Error("Streaming response ended before completion.");
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

export function createStreamingActions(
  set: BranchMindSet,
  get: BranchMindGet,
): BranchMindStreamingActions {
  return {
    startPendingInitialProjectStream: (projectId) => {
      const state = get();
      const pending = getProjectPendingStream(state, projectId);
      if (!pending || state.creatingNodeId || state.streamingNodeId) return;

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
          pendingProjectSyncs: { ...current.pendingProjectSyncs, [projectId]: failedRecord },
          aiError: errorMessage,
        }));
      });
    },

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

          if (!completed) throw new Error("Streaming response ended before completion.");
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
                ? replaceProject(current.projects, removeDraftChildNode(currentProject, draft.node.id))
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

    populateBlankNode: (nodeId, instruction, attachments, modelSelection, skill) =>
      populateBlankNodeInPlace(set, get, { nodeId, instruction, attachments, modelSelection, skill }),

    editUserMessage: async (nodeId, userMessageId, instruction, modelSelection, skill) => {
      const trimmed = instruction.trim();
      if (!trimmed) return false;
      return regenerateNodeInPlace(set, get, { nodeId, instruction: trimmed, userMessageId, modelSelection, skill });
    },

    retryAssistantMessage: (nodeId, assistantMessageId, modelSelection, skill) =>
      regenerateNodeInPlace(set, get, { nodeId, assistantMessageId, modelSelection, skill }),
  };
}
