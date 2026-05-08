export type BranchType = "root" | "continue" | "branch";

export type ChatRole = "user" | "assistant";

export type NodePosition = {
  x: number;
  y: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
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
