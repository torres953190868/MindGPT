import type { ChatAttachment } from "@/lib/types";

export const MAX_CHAT_ATTACHMENTS = 10;

const MAX_ATTACHMENT_ID_LENGTH = 120;
const MAX_ATTACHMENT_NAME_LENGTH = 240;
const MAX_ATTACHMENT_MIME_TYPE_LENGTH = 120;
const MAX_ATTACHMENT_ERROR_LENGTH = 500;
const MAX_ATTACHMENT_REQUEST_ID_LENGTH = 160;
const DOCUMENT_STATUSES = new Set([
  "queued",
  "uploaded",
  "parsing",
  "parsed",
  "indexing",
  "indexed",
  "failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanRequiredString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanSize(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function cleanTimestamp(value: unknown, fallback: string) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return fallback;
}

function cleanDocumentStatus(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return DOCUMENT_STATUSES.has(trimmed)
    ? (trimmed as ChatAttachment["documentStatus"])
    : undefined;
}

export function normalizeChatAttachments(
  value: unknown,
  options: {
    createId?: () => string;
    fallbackCreatedAt?: string;
  } = {},
): ChatAttachment[] {
  if (!Array.isArray(value)) return [];

  const fallbackCreatedAt = options.fallbackCreatedAt ?? new Date(0).toISOString();

  return value.slice(0, MAX_CHAT_ATTACHMENTS).flatMap((attachment) => {
    if (!isRecord(attachment)) return [];

    const id =
      cleanRequiredString(attachment.id, MAX_ATTACHMENT_ID_LENGTH) ?? options.createId?.();
    const name = cleanRequiredString(attachment.name, MAX_ATTACHMENT_NAME_LENGTH);

    if (!id || !name) return [];

    const normalized: ChatAttachment = {
      id,
      name,
      mimeType: cleanOptionalString(
        attachment.mimeType,
        MAX_ATTACHMENT_MIME_TYPE_LENGTH,
      ),
      size: cleanSize(attachment.size),
      createdAt: cleanTimestamp(attachment.createdAt, fallbackCreatedAt),
    };

    const documentId = cleanOptionalString(attachment.documentId, MAX_ATTACHMENT_ID_LENGTH);
    const documentStatus = cleanDocumentStatus(attachment.documentStatus);
    const errorMessage = cleanOptionalString(
      attachment.errorMessage,
      MAX_ATTACHMENT_ERROR_LENGTH,
    );
    const errorRequestId = cleanOptionalString(
      attachment.errorRequestId,
      MAX_ATTACHMENT_REQUEST_ID_LENGTH,
    );

    if (documentId) normalized.documentId = documentId;
    if (documentStatus) normalized.documentStatus = documentStatus;
    if (errorMessage) normalized.errorMessage = errorMessage;
    if (errorRequestId) normalized.errorRequestId = errorRequestId;

    return normalized;
  });
}
