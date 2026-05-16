"use client";

import { ROOT_POSITION } from "@/lib/graph";
import { createId } from "@/lib/ids";
import type {
  ChatAttachment,
  ChatMessage,
  ChatModelSelection,
  MindNode,
  Project,
} from "@/lib/types";

export const PENDING_PROJECT_SYNC_KEY = "branchmind.pendingProjectSync.v1";
export const PENDING_ROOT_TITLE = "Generating answer...";
export const PENDING_ROOT_SUMMARY = "Streaming AI response.";

export type PendingProjectSyncStatus = "syncing" | "synced" | "failed";

export type PendingProjectSyncRecord = {
  project: Project;
  nodeId: string;
  assistantMessageId: string;
  modelSelection?: ChatModelSelection;
  status: PendingProjectSyncStatus;
  error: string | null;
  updatedAt: string;
};

type StoredPendingProjectSync = {
  version: 1;
  records: PendingProjectSyncRecord[];
};

function now() {
  return new Date().toISOString();
}

function makeMessage(
  role: ChatMessage["role"],
  content: string,
  attachments: ChatAttachment[] = [],
): ChatMessage {
  return {
    id: createId("msg"),
    role,
    content,
    attachments,
    createdAt: now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.rootNodeId === "string" &&
    isRecord(value.nodes)
  );
}

function isPendingProjectSyncRecord(value: unknown): value is PendingProjectSyncRecord {
  return (
    isRecord(value) &&
    isProject(value.project) &&
    typeof value.nodeId === "string" &&
    typeof value.assistantMessageId === "string" &&
    (value.status === "syncing" ||
      value.status === "synced" ||
      value.status === "failed") &&
    (typeof value.error === "string" || value.error === null) &&
    typeof value.updatedAt === "string"
  );
}

function getStorage() {
  if (typeof window === "undefined") {
    throw new Error("Browser storage is not available.");
  }

  return window.localStorage;
}

export function createPendingProjectSyncRecord(
  topic: string,
  attachments: ChatAttachment[] = [],
  modelSelection?: ChatModelSelection,
): PendingProjectSyncRecord {
  const timestamp = now();
  const projectId = createId("project");
  const nodeId = createId("node_root");
  const assistantMessage = makeMessage("assistant", "");
  const rootNode: MindNode = {
    id: nodeId,
    projectId,
    parentId: null,
    title: PENDING_ROOT_TITLE,
    summary: PENDING_ROOT_SUMMARY,
    messages: [makeMessage("user", topic, attachments), assistantMessage],
    children: [],
    position: ROOT_POSITION,
    branchType: "root",
    collapsed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    project: {
      id: projectId,
      title: topic.trim(),
      notes: "",
      rootNodeId: nodeId,
      nodes: { [nodeId]: rootNode },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    nodeId,
    assistantMessageId: assistantMessage.id,
    modelSelection,
    status: "syncing",
    error: null,
    updatedAt: timestamp,
  };
}

export function readPendingProjectSyncRecords() {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(PENDING_PROJECT_SYNC_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as StoredPendingProjectSync;
    return Array.isArray(parsed.records)
      ? parsed.records.filter(isPendingProjectSyncRecord)
      : [];
  } catch {
    return [];
  }
}

export function writePendingProjectSyncRecords(records: PendingProjectSyncRecord[]) {
  const payload: StoredPendingProjectSync = {
    version: 1,
    records,
  };

  getStorage().setItem(PENDING_PROJECT_SYNC_KEY, JSON.stringify(payload));
}

export function upsertPendingProjectSyncRecord(record: PendingProjectSyncRecord) {
  const records = readPendingProjectSyncRecords();
  const nextRecords = [
    record,
    ...records.filter((item) => item.project.id !== record.project.id),
  ];

  writePendingProjectSyncRecords(nextRecords);
}

export function removePendingProjectSyncRecord(projectId: string) {
  const nextRecords = readPendingProjectSyncRecords().filter(
    (record) => record.project.id !== projectId,
  );
  writePendingProjectSyncRecords(nextRecords);
}
