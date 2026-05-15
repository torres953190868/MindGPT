export type BranchType = "root" | "continue" | "branch";

export type ChatRole = "user" | "assistant";

export type NodePosition = {
  x: number;
  y: number;
};

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  documentId?: string;
  documentStatus?: "uploaded" | "parsing" | "parsed" | "indexing" | "indexed" | "failed";
  errorMessage?: string | null;
};

export type ChatDocumentContext = {
  documentId: string;
  fileName: string;
  title: string | null;
  snippets: Array<{
    chunkId: string;
    pageStart: number;
    pageEnd: number;
    headingPath: string[];
    content: string;
  }>;
};

export type ChatModelSelection = {
  providerId: string;
  model: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachment[];
  createdAt: string;
};

export type MindNode = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  summary: string;
  messages: ChatMessage[];
  children: string[];
  position: NodePosition;
  branchType: BranchType;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  ownerSessionId?: string;
  title: string;
  notes: string;
  rootNodeId: string;
  nodes: Record<string, MindNode>;
  createdAt: string;
  updatedAt: string;
};

export type MockMode = "root" | "continue" | "branch";

export type MockReply = {
  title: string;
  summary: string;
  content: string;
};
