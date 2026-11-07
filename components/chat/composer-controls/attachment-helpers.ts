import { readJsonApi } from "@/lib/client/api";
import type { ChatAttachment } from "@/lib/types";
import type {
  DocumentDetailsResponse,
  DocumentStatus,
  IndexPdfResponse,
  PendingChatAttachment,
  UploadPdfResponse,
} from "./types";

export const PDF_INDEX_POLL_INTERVAL_MS = 2_500;
export const PDF_INDEX_POLL_TIMEOUT_MS = 5 * 60 * 1000;
// Synthetic mime type for curriculum attachments; lets the UI tell course
// materials apart from files without inspecting curriculumId everywhere.
export const CURRICULUM_ATTACHMENT_MIME_TYPE = "application/x-branchmind-curriculum";

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function getAttachmentTypeLabel(
  attachment: ChatAttachment,
  unknownTypeLabel: string,
) {
  return attachment.mimeType || unknownTypeLabel;
}

export function isKnowledgeAttachment(
  attachment: Pick<ChatAttachment, "documentId" | "curriculumId" | "size">,
) {
  return Boolean(
    (attachment.documentId || attachment.curriculumId) && attachment.size === 0,
  );
}

export function getAttachmentDetailLabel(
  attachment: ChatAttachment,
  labels: {
    knowledgePdf: string;
    unknownType: string;
    knowledgeCurriculum?: string;
  } = {
    knowledgePdf: "Knowledge PDF",
    unknownType: "Unknown type",
  },
) {
  if (attachment.curriculumId) return labels.knowledgeCurriculum ?? "Course material";
  if (isKnowledgeAttachment(attachment)) return labels.knowledgePdf;
  return `${getAttachmentTypeLabel(attachment, labels.unknownType)} - ${formatFileSize(attachment.size)}`;
}

export function getPendingAttachmentStatusLabel(
  attachment: PendingChatAttachment,
  labels: {
    failed: string;
    indexed: string;
    ingesting: string;
    uploading: string;
  },
) {
  if (attachment.uploadStatus === "uploading") return labels.uploading;
  if (attachment.uploadStatus === "queued" || attachment.uploadStatus === "indexing") {
    return labels.ingesting;
  }
  if (attachment.uploadStatus === "indexed") return labels.indexed;
  if (attachment.uploadStatus === "failed") return labels.failed;
  if (attachment.documentId && attachment.documentStatus === "indexed") return labels.indexed;
  return null;
}

export function isPdfAttachment(attachment: PendingChatAttachment) {
  return (
    attachment.file?.type === "application/pdf" ||
    attachment.mimeType.toLowerCase() === "application/pdf" ||
    attachment.name.toLowerCase().endsWith(".pdf")
  );
}

export function isIndexingStatus(status: DocumentStatus | undefined) {
  return status === "queued" || status === "parsing" || status === "indexing";
}

export function shouldEnqueueIndex(status: DocumentStatus | undefined) {
  return (
    status !== "queued" &&
    status !== "parsing" &&
    status !== "indexing" &&
    status !== "indexed"
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForIndexedDocument(documentId: string) {
  const deadline = Date.now() + PDF_INDEX_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const details = await readJsonApi<DocumentDetailsResponse>(
      `/api/documents/${documentId}`,
    );
    const document = details.document;

    if (document.status === "indexed") return document;
    if (document.status === "failed") {
      const reference = document.errorRequestId
        ? ` (Reference: ${document.errorRequestId})`
        : "";
      throw new Error(
        `${document.errorMessage || "PDF indexing failed."}${reference}`,
      );
    }

    await wait(PDF_INDEX_POLL_INTERVAL_MS);
  }

  throw new Error("PDF indexing is still running. Please try sending again shortly.");
}

export async function ingestPdfAttachment(
  attachment: PendingChatAttachment,
  onProgress: (next: PendingChatAttachment) => void,
) {
  let current: PendingChatAttachment = {
    ...attachment,
    uploadStatus: attachment.documentId
      ? isIndexingStatus(attachment.documentStatus)
        ? "indexing"
        : "queued"
      : "uploading",
    errorMessage: null,
    errorRequestId: null,
  };
  onProgress(current);

  if (!current.documentId) {
    const formData = new FormData();
    formData.set("file", attachment.file as File);
    const upload = await readJsonApi<UploadPdfResponse>("/api/documents/upload", {
      method: "POST",
      body: formData,
    });

    current = {
      ...current,
      documentId: upload.document.id,
      documentStatus: upload.document.status,
      mimeType: upload.document.mimeType || current.mimeType || "application/pdf",
      uploadStatus: "queued",
    };
    onProgress(current);
  }

  if (!current.documentId) {
    throw new Error("PDF upload did not return a document id.");
  }

  const documentId = current.documentId;
  if (shouldEnqueueIndex(current.documentStatus)) {
    await readJsonApi<IndexPdfResponse>(
      `/api/documents/${documentId}/index`,
      { method: "POST" },
    );
  }

  current = {
    ...current,
    uploadStatus: "indexing",
  };
  onProgress(current);

  const indexed = await waitForIndexedDocument(documentId);
  current = {
    ...current,
    documentStatus: indexed.status,
    errorMessage: indexed.errorMessage,
    errorRequestId: indexed.errorRequestId,
    uploadStatus: "indexed",
  };
  onProgress(current);

  return current;
}

export function toSendableAttachment(attachment: PendingChatAttachment): ChatAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
    ...(attachment.curriculumId ? { curriculumId: attachment.curriculumId } : {}),
    ...(attachment.documentStatus ? { documentStatus: attachment.documentStatus } : {}),
    ...(attachment.errorMessage ? { errorMessage: attachment.errorMessage } : {}),
    ...(attachment.errorRequestId ? { errorRequestId: attachment.errorRequestId } : {}),
  };
}

export function replacePendingAttachment(
  attachments: PendingChatAttachment[],
  next: PendingChatAttachment,
) {
  return attachments.map((attachment) => (attachment.id === next.id ? next : attachment));
}
