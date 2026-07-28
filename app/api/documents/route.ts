import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { listDocumentsForOwner } from "@/lib/server/rag/service";

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    const { principal, session } = await getBranchMindAuthContext(request);
    const documents = await listDocumentsForOwner(principal.id);
    return jsonWithSession({ documents }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    return jsonWithSession(
      {
        error: {
          message: "Use POST /api/documents/upload for multipart PDF uploads.",
        },
      },
      fallbackSession,
      { status: 405 },
    );
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
