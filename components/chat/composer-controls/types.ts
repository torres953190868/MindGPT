import type { ChatAttachment, ChatModelSelection } from "@/lib/types";

export type ChatModelOption = ChatModelSelection & {
  providerName: string;
  configured: boolean;
  locked?: boolean;
};

export type ChatModelCatalogResponse = {
  defaultSelection?: ChatModelSelection;
  providers?: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    models: string[];
    lockedModels?: string[];
  }>;
};

export type NormalizedModelCatalog = {
  options: ChatModelOption[];
  defaultSelection: ChatModelSelection;
};

export type DocumentStatus = NonNullable<ChatAttachment["documentStatus"]>;

export type PendingAttachmentStatus =
  | "queued"
  | "uploading"
  | "indexing"
  | "indexed"
  | "failed";

export type PendingChatAttachment = ChatAttachment & {
  file?: File;
  uploadStatus?: PendingAttachmentStatus;
};

export type UploadedDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  status: DocumentStatus;
  errorMessage: string | null;
  errorRequestId: string | null;
};

export type KnowledgeDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  title: string | null;
  status: DocumentStatus;
  errorMessage: string | null;
  errorRequestId: string | null;
  updatedAt: string;
};

// A published curriculum the user can attach as knowledge context, as returned
// by GET /api/curricula/attachable.
export type AttachableCurriculumItem = {
  curriculumId: string;
  title: string;
  subject: string;
  versionId: string;
  versionLabel: string;
};

export type AttachableCurriculaResponse = {
  items: AttachableCurriculumItem[];
};

export type UploadPdfResponse = {
  document: UploadedDocument;
  job?: {
    action: "parse" | "index";
    documentId: string;
    messageId: string | null;
    requestId: string;
    topic: string;
  };
};

export type IndexPdfResponse = {
  job: {
    action: "parse" | "index";
    documentId: string;
    messageId: string | null;
    requestId: string;
    topic: string;
  };
};

export type DocumentDetailsResponse = {
  document: UploadedDocument;
};

export type DocumentsResponse = {
  documents: KnowledgeDocument[];
};

export type FloatingMenuPlacement = "above" | "below";
export type FloatingMenuAlignment = "start" | "end";
