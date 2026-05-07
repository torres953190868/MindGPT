import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { importProjectsForOwner } from "@/lib/server/projects-service";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

const IMPORT_LIMIT = 10;
const IMPORT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { principal, session } = await getBranchMindAuthContext(request);
    const payload = await parseJsonBody(request, z.unknown(), {
      maxBytes: 512 * 1024,
    });
    const rateLimit = await checkRateLimitAsync(request, {
      action: "import-projects",
      sessionId: principal.id,
      limit: IMPORT_LIMIT,
      windowMs: IMPORT_WINDOW_MS,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        session,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const result = await importProjectsForOwner(principal.id, payload);
    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
