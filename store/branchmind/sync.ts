import {
  readPendingProjectSyncRecords,
  removePendingProjectSyncRecord,
  type PendingProjectSyncRecord,
  upsertPendingProjectSyncRecord,
} from "@/lib/client/pending-project-sync";
import type { Project } from "@/lib/types";
import {
  applyPendingNodePositionSyncRecords,
  clearLegacyProjects,
  getActiveProject,
  getErrorMessage,
  getPendingSyncMap,
  getSelectedNodeId,
  isPendingNodePositionSyncRecord,
  mergePendingProjects,
  newestTimestamp,
  nodePositionKey,
  positionsEqual,
  readJson,
  readLegacyProjects,
  replaceProject,
  upsertProject,
} from "./helpers";
import type {
  BranchMindGet,
  BranchMindSet,
  BranchMindState,
  PendingInitialProjectStream,
  PendingNodePositionSync,
  PendingNodePositionSyncRecord,
  ProjectsResponse,
  StoredPendingNodePositionSyncs,
  SyncProjectResponse,
  UpdateNodeResponse,
} from "./types";

const PENDING_NODE_POSITION_SYNC_KEY = "branchmind.pendingNodePositionSync.v1";
const NODE_POSITION_SYNC_DELAY_MS = 750;
const NODE_POSITION_SYNC_RETRY_DELAY_MS = 5_000;

const inFlightProjectSyncs = new Set<string>();
const pendingNodePositionVersions = new Map<string, number>();
const pendingNodePositionSyncs = new Map<string, PendingNodePositionSync>();
let nextNodePositionVersion = 0;
let nodePositionFlushListenersInstalled = false;

export function allocateNodePositionVersion(projectId: string, nodeId: string): number {
  const positionKey = nodePositionKey(projectId, nodeId);
  const positionVersion = ++nextNodePositionVersion;
  pendingNodePositionVersions.set(positionKey, positionVersion);
  return positionVersion;
}

export function readPendingNodePositionSyncRecords(): PendingNodePositionSyncRecord[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PENDING_NODE_POSITION_SYNC_KEY);
  } catch {
    // Storage blocked (e.g. Safari with cookies disabled): no pending positions.
    return [];
  }
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

export function writePendingNodePositionSyncRecords(
  records: PendingNodePositionSyncRecord[],
): void {
  if (typeof window === "undefined") return;

  const payload: StoredPendingNodePositionSyncs = { version: 1, records };
  try {
    window.localStorage.setItem(PENDING_NODE_POSITION_SYNC_KEY, JSON.stringify(payload));
  } catch {
    // Storage is only a reload resilience layer; positions still sync from memory.
  }
}

export function persistPendingNodePositionSyncRecord(
  record: PendingNodePositionSyncRecord,
): void {
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

export function clearPendingNodePositionSyncRecord(projectId: string, nodeId: string): void {
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

export function reconcilePendingNodePositionSyncRecords(
  records: PendingNodePositionSyncRecord[],
): void {
  try {
    writePendingNodePositionSyncRecords(records);
  } catch {
    // Keep going; the in-memory project state has already been reconciled.
  }
}

export function persistPendingSyncRecord(record: PendingProjectSyncRecord): boolean {
  try {
    upsertPendingProjectSyncRecord(record);
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSyncRecord(projectId: string): void {
  try {
    removePendingProjectSyncRecord(projectId);
  } catch {
    // The server is the source of truth after streaming completes.
  }
}

export function clearPendingProjectSyncLocally(set: BranchMindSet, projectId: string): void {
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

export function removeProjectLocally(
  set: BranchMindSet,
  get: BranchMindGet,
  projectId: string,
): void {
  const nextProjects = get().projects.filter((project) => project.id !== projectId);
  const activeProject = getActiveProject(nextProjects, get().activeProjectId);

  set({
    projects: nextProjects,
    activeProjectId: activeProject?.id ?? null,
    selectedNodeId: getSelectedNodeId(activeProject, get().selectedNodeId),
    aiError: null,
  });
}

function mergeConfirmedNodePosition(
  set: BranchMindSet,
  pending: PendingNodePositionSync,
  data: UpdateNodeResponse,
): void {
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

    return { projects: replaceProject(current.projects, nextProject), aiError: null };
  });

  clearPendingNodePositionSyncRecord(pending.projectId, pending.nodeId);
  pendingNodePositionVersions.delete(positionKey);
}

async function flushPendingNodePositionSync(
  set: BranchMindSet,
  key: string,
  options: { keepalive?: boolean; reportErrors?: boolean } = {},
): Promise<void> {
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
      pendingNodePositionSyncs.set(key, { ...pending, timer });
    }
  }
}

export function flushPendingNodePositionSyncs(
  set: BranchMindSet,
  options: { keepalive?: boolean; reportErrors?: boolean } = {},
): void {
  for (const key of Array.from(pendingNodePositionSyncs.keys())) {
    void flushPendingNodePositionSync(set, key, options);
  }
}

function installNodePositionFlushListeners(set: BranchMindSet): void {
  if (
    nodePositionFlushListenersInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  nodePositionFlushListenersInstalled = true;
  const flushForPageExit = () => {
    flushPendingNodePositionSyncs(set, { keepalive: true, reportErrors: false });
  };

  window.addEventListener("pagehide", flushForPageExit);
  window.addEventListener("beforeunload", flushForPageExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushForPageExit();
  });
}

export function queueNodePositionSync(
  set: BranchMindSet,
  record: PendingNodePositionSyncRecord,
  options: { delayMs?: number; version?: number } = {},
): void {
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

  pendingNodePositionSyncs.set(key, { ...record, version, timer });
}

export function getProjectPendingStream(
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

export function setPendingSyncRecord(
  set: BranchMindSet,
  record: PendingProjectSyncRecord,
): void {
  persistPendingSyncRecord(record);
  set((current) => ({
    pendingProjectSyncs: {
      ...current.pendingProjectSyncs,
      [record.project.id]: record,
    },
  }));
}

export function syncPendingProject(
  set: BranchMindSet,
  get: BranchMindGet,
  projectId: string,
): void {
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
        pendingProjectSyncs: { ...current.pendingProjectSyncs, [projectId]: syncedRecord },
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
        pendingProjectSyncs: { ...current.pendingProjectSyncs, [projectId]: failedRecord },
        aiError: current.activeProjectId === projectId ? failedRecord.error : current.aiError,
      }));
      persistPendingSyncRecord(failedRecord);
    } finally {
      inFlightProjectSyncs.delete(projectId);
    }
  })();
}

export async function loadProjects(): Promise<{
  projects: Project[];
  preferredProjectId: string | null;
  pendingProjectSyncs: Record<string, PendingProjectSyncRecord>;
  pendingNodePositions: PendingNodePositionSyncRecord[];
  warning: string | null;
}> {
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
