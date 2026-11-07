"use client";

import { create } from "zustand";
import { createCrudActions } from "./branchmind/crud-actions";
import {
  getActiveProject,
  getErrorMessage,
  getSelectedNodeId,
} from "./branchmind/helpers";
import { createStreamingActions } from "./branchmind/streaming-actions";
import {
  loadProjects,
  queueNodePositionSync,
  syncPendingProject,
} from "./branchmind/sync";
import type {
  ApiErrorPayload,
  BlankChildNodeCreation,
  BranchMindCrudActions,
  BranchMindDataState,
  BranchMindGet,
  BranchMindSet,
  BranchMindState,
  BranchMindStreamingActions,
  CreateProjectResponse,
  PendingInitialProjectStream,
  PendingNodePositionSync,
  PendingNodePositionSyncRecord,
  ProjectsResponse,
  RegenerateRollback,
  StoredPendingNodePositionSyncs,
  SyncProjectResponse,
  UpdateNodeResponse,
  UpdateProjectResponse,
} from "./branchmind/types";

export type {
  ApiErrorPayload,
  BlankChildNodeCreation,
  BranchMindCrudActions,
  BranchMindDataState,
  BranchMindGet,
  BranchMindSet,
  BranchMindState,
  BranchMindStreamingActions,
  CreateProjectResponse,
  PendingInitialProjectStream,
  PendingNodePositionSync,
  PendingNodePositionSyncRecord,
  ProjectsResponse,
  RegenerateRollback,
  StoredPendingNodePositionSyncs,
  SyncProjectResponse,
  UpdateNodeResponse,
  UpdateProjectResponse,
};

/**
 * Initial client workspace data state before hydration or user interaction.
 *
 * State responsibilities:
 * - `projects`: Hydrated projects merged with any local-only pending sync records
 *   and un-flushed optimistic node position updates.
 * - `activeProjectId` / `selectedNodeId`: Currently focused workspace project and node.
 * - `hydrated`: Whether initial browser hydration (`hydrate()`) has completed.
 * - `creatingProject` / `creatingNodeId`: Optimistic creation guards to prevent
 *   concurrent conflicting mutations.
 * - `streamingNodeId` / `streamingMessageId`: Active SSE generation target IDs.
 * - `pendingInitialProjectStream`: Queued initial assistant stream for newly created projects.
 * - `pendingProjectSyncs`: Background sync status map for offline/resilient project creation.
 * - `aiError`: User-visible workspace/AI error banner message.
 */
const INITIAL_BRANCHMIND_DATA_STATE: BranchMindDataState = {
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
};

/**
 * Assembles the full BranchMind Zustand store by combining:
 * - Hydrated & optimistic project/node state (`BranchMindDataState`)
 * - Hydration, selection, and pending sync coordination
 * - Project/node CRUD, notes, collapse, title, and position sync actions (`createCrudActions`)
 * - Streaming AI node generation, blank node population, and message regeneration actions (`createStreamingActions`)
 *
 * Module decomposition under `store/branchmind/`:
 * - `types.ts`: Store state/action contracts, optimistic sync records, and API response shapes.
 * - `helpers.ts`: Error normalization, localized copy lookup, legacy localStorage migration,
 *   and pure project/node/sync state transformation helpers.
 * - `sync.ts`: Background project sync queue, debounced node position sync with page-exit
 *   flush listeners, and initial project hydration loader.
 * - `streaming-actions.ts`: SSE streaming node creation, blank node population, and in-place
 *   message edit/retry regeneration with rollback support.
 * - `crud-actions.ts`: Project/node CRUD, title/notes updates, debounced position updates,
 *   and serialized node collapse toggling.
 */
export const useBranchMindStore = create<BranchMindState>((set, get) => {
  const crudActions = createCrudActions(set, get);
  const streamingActions = createStreamingActions(set, get);

  return {
    ...INITIAL_BRANCHMIND_DATA_STATE,

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
        } = await loadProjects();
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

    retryPendingProjectSync: (projectId) => {
      syncPendingProject(set, get, projectId);
    },

    selectProject: (projectId) => {
      const project = get().projects.find((item) => item.id === projectId);
      if (!project) return;

      set({ activeProjectId: projectId, selectedNodeId: project.rootNodeId });
    },

    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

    ...crudActions,
    ...streamingActions,
  };
});
