import type { Json } from "@/lib/supabase/database.types";
import { getSafeErrorStatus } from "@/lib/server/http";
import { RagError } from "./errors";
import type { RagDocument, RagErrorStage } from "./types";

type DiagnosticContext = {
  requestId: string;
  stage: RagErrorStage;
};

export type RagFailureDiagnostic = {
  code: string;
  message: string;
  requestId: string;
  stage: RagErrorStage;
  status: number;
  details: Json;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Document indexing failed.";
}

function errorCode(error: unknown, status: number) {
  const code = isRecord(error) ? stringValue(error.code) : null;
  if (code) return code;
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "RAG_INTERNAL_ERROR";
  return "RAG_ERROR";
}

function getProviderDetails(error: unknown) {
  const details = isRecord(error) ? error.details : null;
  return isRecord(details) ? details : {};
}

function friendlyMessage(error: unknown, code: string, status: number) {
  if (code === "PDF_TEXT_EMPTY") {
    return "This PDF does not contain enough selectable text. OCR is not supported yet.";
  }

  if (status === 429 && /embedding/i.test(code)) {
    return "Embedding quota or rate limit was reached. Try again later or increase the provider quota.";
  }

  if (code === "DASHSCOPE_API_KEY_MISSING" || code === "GEMINI_API_KEY_MISSING") {
    return safeErrorMessage(error);
  }

  if (error instanceof RagError && error.expose && status < 500) {
    return safeErrorMessage(error);
  }

  if (status >= 500) return "Document indexing failed.";
  return safeErrorMessage(error);
}

function toJsonObject(value: Record<string, unknown>): Json {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
  ) as Json;
}

export function createRagFailureDiagnostic(
  error: unknown,
  context: DiagnosticContext,
): RagFailureDiagnostic {
  const status = getSafeErrorStatus(error);
  const code = errorCode(error, status);
  const providerDetails = getProviderDetails(error);
  const provider = stringValue(providerDetails.provider);
  const model = stringValue(providerDetails.model);
  const upstreamStatus = numberValue(providerDetails.upstreamStatus);

  return {
    code,
    message: friendlyMessage(error, code, status),
    requestId: context.requestId,
    stage: context.stage,
    status,
    details: toJsonObject({
      originalMessage: safeErrorMessage(error),
      provider,
      model,
      upstreamStatus,
      status,
      retryable:
        typeof providerDetails.retryable === "boolean"
          ? providerDetails.retryable
          : undefined,
    }),
  };
}

export function logRagFailureDiagnostic(
  document: Pick<RagDocument, "id" | "fileName">,
  diagnostic: RagFailureDiagnostic,
) {
  const details = isRecord(diagnostic.details) ? diagnostic.details : {};
  console.error("BranchMind RAG indexing failed", {
    requestId: diagnostic.requestId,
    action: "index-document",
    documentId: document.id,
    fileName: document.fileName,
    stage: diagnostic.stage,
    code: diagnostic.code,
    status: diagnostic.status,
    provider: stringValue(details.provider),
    model: stringValue(details.model),
    upstreamStatus: numberValue(details.upstreamStatus),
    message: diagnostic.message,
    originalMessage: stringValue(details.originalMessage),
  });
}
