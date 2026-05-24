import {
  handleCallback,
  send,
  type MessageMetadata,
  type MessageHandler,
  type RetryDirective,
} from "@vercel/queue";
import { DEFAULT_CHUNK_VERSION, PDF_PARSER_VERSION } from "./config";
import { RagError } from "./errors";
import { indexDocumentForOwner, parseDocumentForOwner } from "./indexer";
import { getRagRepository, requireOwnedDocument } from "./store";

export const RAG_PROCESSING_TOPIC = "rag-document-processing";

export type RagProcessingAction = "parse" | "index";

export type RagProcessingJob = {
  action: RagProcessingAction;
  userId: string;
  documentId: string;
  requestId: string;
};

export type EnqueuedRagProcessingJob = {
  action: RagProcessingAction;
  documentId: string;
  messageId: string | null;
  requestId: string;
  topic: typeof RAG_PROCESSING_TOPIC;
};

const QUEUE_RETENTION_SECONDS = 24 * 60 * 60;
const MAX_TRANSIENT_DELIVERIES = 5;
type QueueRouteHandler = ReturnType<typeof handleCallback<RagProcessingJob>>;
let queueRouteHandler: QueueRouteHandler | null = null;

const CLEAR_RAG_ERROR = {
  errorCode: null,
  errorDetails: null,
  errorMessage: null,
  errorRequestId: null,
  errorStage: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getQueueMode() {
  const value = process.env.BRANCHMIND_RAG_QUEUE_MODE?.trim().toLowerCase();
  if (value === "inline" || value === "queue") return value;
  return process.env.NODE_ENV === "development" ? "inline" : "queue";
}

function getErrorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : null;
}

function runInlineRagProcessingJob(job: RagProcessingJob, details: unknown) {
  console.info("BranchMind RAG running job inline", {
    action: job.action,
    details,
    documentId: job.documentId,
    requestId: job.requestId,
    topic: RAG_PROCESSING_TOPIC,
  });

  void processRagProcessingJob(job).catch((error) => {
    const failureDetails = getErrorDetails(error);
    console.error("BranchMind inline RAG processing failed", {
      action: job.action,
      details: failureDetails,
      documentId: job.documentId,
      requestId: job.requestId,
      topic: RAG_PROCESSING_TOPIC,
    });
  });
}

export function parseRagProcessingJob(value: unknown): RagProcessingJob {
  if (!isRecord(value)) {
    throw new RagError("RAG processing job payload must be an object.", {
      code: "RAG_JOB_INVALID",
      status: 400,
    });
  }

  const { action, userId, documentId, requestId } = value;
  if (action !== "parse" && action !== "index") {
    throw new RagError("RAG processing job action must be parse or index.", {
      code: "RAG_JOB_ACTION_INVALID",
      status: 400,
    });
  }
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    typeof documentId !== "string" ||
    !documentId.trim() ||
    typeof requestId !== "string" ||
    !requestId.trim()
  ) {
    throw new RagError("RAG processing job is missing required identifiers.", {
      code: "RAG_JOB_IDENTIFIERS_INVALID",
      status: 400,
    });
  }

  return {
    action,
    userId: userId.trim(),
    documentId: documentId.trim(),
    requestId: requestId.trim(),
  };
}

function getErrorStatus(error: unknown) {
  const status = isRecord(error) ? Number(error.status) : NaN;
  return Number.isInteger(status) ? status : null;
}

function shouldAcknowledgeFailure(error: unknown, deliveryCount: number) {
  const status = getErrorStatus(error);
  if (status && status >= 400 && status < 500 && status !== 429) return true;
  return deliveryCount >= MAX_TRANSIENT_DELIVERIES;
}

export function getRagProcessingRetryDirective(
  error: unknown,
  metadata: MessageMetadata,
): RetryDirective {
  if (shouldAcknowledgeFailure(error, metadata.deliveryCount)) {
    return { acknowledge: true };
  }

  return {
    afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 10),
  };
}

export async function enqueueRagProcessingJob(
  userId: string,
  documentId: string,
  action: RagProcessingAction,
  requestId: string,
): Promise<EnqueuedRagProcessingJob> {
  const repository = getRagRepository();
  const document = await requireOwnedDocument(userId, documentId);

  await repository.setDocumentStatus(document.id, "queued", {
    ...CLEAR_RAG_ERROR,
    parserVersion: PDF_PARSER_VERSION,
    chunkVersion: DEFAULT_CHUNK_VERSION,
  });

  const job: RagProcessingJob = {
    action,
    userId,
    documentId,
    requestId,
  };

  const queueMode = getQueueMode();
  if (queueMode === "inline") {
    runInlineRagProcessingJob(job, { mode: "inline" });
    return {
      action,
      documentId,
      messageId: null,
      requestId,
      topic: RAG_PROCESSING_TOPIC,
    };
  }

  try {
    const result = await send(RAG_PROCESSING_TOPIC, job, {
      headers: { "x-request-id": requestId },
      idempotencyKey: `${action}:${documentId}:${requestId}`,
      retentionSeconds: QUEUE_RETENTION_SECONDS,
    });

    return {
      action,
      documentId,
      messageId: result.messageId,
      requestId,
      topic: RAG_PROCESSING_TOPIC,
    };
  } catch (error) {
    const details = getErrorDetails(error);

    const queueError = new RagError(
      "PDF processing could not be queued. Please retry.",
      {
        code: "RAG_QUEUE_ENQUEUE_FAILED",
        details,
        expose: true,
        status: 502,
      },
    );

    await repository.setDocumentStatus(document.id, "failed", {
      errorCode: "RAG_QUEUE_ENQUEUE_FAILED",
      errorDetails: details,
      errorMessage: queueError.message,
      errorRequestId: requestId,
      errorStage: null,
    });
    throw queueError;
  }
}

export async function processRagProcessingJob(payload: unknown) {
  const job = parseRagProcessingJob(payload);

  if (job.action === "parse") {
    await parseDocumentForOwner(job.userId, job.documentId, {
      requestId: job.requestId,
    });
    return;
  }

  await indexDocumentForOwner(job.userId, job.documentId, {
    requestId: job.requestId,
  });
}

export function getRagProcessingQueueHandler() {
  queueRouteHandler ??= handleCallback<RagProcessingJob>(
    processRagProcessingJob as MessageHandler<RagProcessingJob>,
    {
      retry: getRagProcessingRetryDirective,
      visibilityTimeoutSeconds: 900,
    },
  );
  return queueRouteHandler;
}
