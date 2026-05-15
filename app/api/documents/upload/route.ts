import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { RagError } from "@/lib/server/rag/errors";
import { uploadPdfForOwner } from "@/lib/server/rag/service";

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

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const document = await uploadPdfForOwner(
      principal.id,
      getPdfFile(await request.formData()),
    );

    return jsonWithSession({ document }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
