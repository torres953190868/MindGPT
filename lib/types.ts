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
  documentStatus?:
    | "queued"
    | "uploaded"
    | "parsing"
    | "parsed"
    | "indexing"
    | "indexed"
    | "failed";
  errorMessage?: string | null;
  errorRequestId?: string | null;
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

export type ChatCitation = {
  index: number;
  documentId: string;
  documentName: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  headingPath: string[];
  quote: string;
};

export type ChatModelSelection = {
  providerId: string;
  model: string;
};

export type LlmRouteTask = "node_generation" | "branch_chat" | "pdf_qa";

export type LlmProviderConfig = {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKeyEnv: string;
  enabled: boolean;
  timeoutMs: number | null;
  payloadOptions: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type LlmModelConfig = {
  providerId: string;
  model: string;
  displayName: string;
  enabled: boolean;
  supportsStreaming: boolean;
  supportsJson: boolean;
  notes: string | null;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type LlmRouteConfig = {
  task: LlmRouteTask;
  defaultProviderId: string;
  defaultModel: string;
  fallbackProviderId: string | null;
  fallbackModel: string | null;
  updatedAt?: string;
};

export type BugReportStatus = "open" | "triaged" | "fixed" | "closed";

export type CreateBugReportInput = {
  title: string;
  description: string;
  contactEmail?: string | null;
  currentUrl?: string | null;
  userAgent?: string | null;
};

export type BugReportDto = {
  id: string;
  title: string;
  description: string;
  status: BugReportStatus;
  contactEmail: string | null;
  currentUrl: string | null;
  createdAt: string;
};

export type AdminBugReportDto = BugReportDto & {
  reporterUserId: string | null;
  reporterEmail: string | null;
  userAgent: string | null;
  screenshotPath: string | null;
  screenshotUrl: string | null;
  adminNotes: string | null;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachment[];
  citations?: ChatCitation[];
  createdAt: string;
};

export type MindNode = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  titleManuallyEdited: boolean;
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
  citations?: ChatCitation[];
};
