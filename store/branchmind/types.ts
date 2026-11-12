import type { StoreApi } from "zustand";
import type { PendingProjectSyncRecord } from "@/lib/client/pending-project-sync";
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

export type PendingNodePositionSyncRecord = {
  projectId: string;
  nodeId: string;
  position: NodePosition;
  updatedAt: string;
};

export type PendingNodePositionSync = PendingNodePositionSyncRecord & {
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export type StoredPendingNodePositionSyncs = {
  version: 1;
  records: PendingNodePositionSyncRecord[];
};

export type PendingInitialProjectStream = {
  projectId: string;
  nodeId: string;
  assistantMessageId: string;
  modelSelection?: ChatModelSelection;
  skill?: ChatSkill;
};

export type BlankChildNodeCreation = {
  nodeId: string;
  persisted: Promise<string | null>;
};

export type RegenerateRollback = {
  nodeId: string;
  userMessage?: ChatMessage;
  assistantMessage?: ChatMessage;
  title?: string;
};

export type RegenerateNodeOptions = {
  nodeId: string;
  instruction?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  modelSelection?: ChatModelSelection;
  skill?: ChatSkill;
};

export type PopulateBlankNodeOptions = {
  nodeId: string;
  instruction: string;
  attachments?: ChatAttachment[];
  modelSelection?: ChatModelSelection;
  skill?: ChatSkill;
};

export type AppendNodeMessageOptions = {
  nodeId: string;
  instruction: string;
  sourceText?: string;
  attachments?: ChatAttachment[];
  modelSelection?: ChatModelSelection;
  skill?: ChatSkill;
};

export type ProjectsResponse = {
  projects: Project[];
};

export type CreateProjectResponse = ProjectsResponse & {
  project: Project;
  initialStream?: {
    nodeId: string;
    assistantMessageId: string;
  };
};

export type SyncProjectResponse = {
  project: Project;
};

export type UpdateNodeResponse = {
  project: Project;
  node?: MindNode;
  selectedNodeId?: string;
};

export type UpdateProjectResponse = {
  project: Project;
};

export type ApiErrorPayload = {
  error?:
    | string
    | {
        code?: string;
        message?: string;
      };
};

export type BranchMindDataState = {
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
};

export type BranchMindCrudActions = {
  createProject: (
    topic: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  deleteProject: (projectId: string) => Promise<void>;
  createBlankChildNode: (
    parentId: string,
    mode: Exclude<BranchType, "root">,
  ) => BlankChildNodeCreation | null;
  updateProjectTitle: (projectId: string, title: string) => Promise<boolean>;
  updateProjectNotes: (projectId: string, notes: string) => Promise<boolean>;
  updateNodeTitle: (nodeId: string, title: string) => Promise<boolean>;
  updateNodePosition: (nodeId: string, position: NodePosition) => Promise<void>;
  toggleNodeCollapsed: (nodeId: string) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
};

export type BranchMindStreamingActions = {
  startPendingInitialProjectStream: (projectId: string) => void;
  createChildNode: (
    parentId: string,
    mode: Exclude<BranchType, "root">,
    instruction: string,
    sourceText?: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<string | null>;
  populateBlankNode: (
    nodeId: string,
    instruction: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) => Promise<boolean>;
  appendNodeMessage: (
    nodeId: string,
    instruction: string,
    sourceText?: string,
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
};

export type BranchMindState = BranchMindDataState &
  BranchMindCrudActions &
  BranchMindStreamingActions & {
    hydrate: (options?: { force?: boolean }) => Promise<void>;
    clearAiError: () => void;
    retryPendingProjectSync: (projectId: string) => void;
    selectProject: (projectId: string) => void;
    selectNode: (nodeId: string) => void;
  };

export type BranchMindSet = StoreApi<BranchMindState>["setState"];
export type BranchMindGet = StoreApi<BranchMindState>["getState"];
