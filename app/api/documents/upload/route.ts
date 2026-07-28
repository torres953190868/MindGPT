import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { RagError } from "@/lib/server/rag/errors";
import { enqueueRagProcessingJob } from "@/lib/server/rag/jobs";
import { uploadPdfForOwner } from "@/lib/server/rag/service";

const UPLOAD_DOCUMENT_LIMIT = 10;
const UPLOAD_DOCUMENT_WINDOW_MS = 60_000;

function getPdfFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new RagError("A PDF file field named file is required.", {
      code: "PDF_FILE_REQUIRED",
      status: 400,
    });
  }
  return file;
}

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = getOrCreateRequestId(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const rateLimit = await checkRateLimitAsync(request, {
      action: "upload-document",
      sessionId: principal.id,
      limit: UPLOAD_DOCUMENT_LIMIT,
      windowMs: UPLOAD_DOCUMENT_WINDOW_MS,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
        { requestId },
      );
    }

    const document = await uploadPdfForOwner(
      principal.id,
      getPdfFile(await request.formData()),
    );
    const duplicate = document.status !== "uploaded";
    if (document.status !== "uploaded" && document.status !== "failed") {
      return jsonWithSession(
        { document, duplicate, job: null },
        session,
        { status: 200 },
        { requestId },
      );
    }
    const job = await enqueueRagProcessingJob(
      principal.id,
      document.id,
      "index",
      requestId,
    );

    return jsonWithSession(
      { document: { ...document, status: "queued" }, duplicate, job },
      session,
      { status: 202 },
      { requestId },
    );
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
