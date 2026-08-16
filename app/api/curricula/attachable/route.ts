import type { NextRequest } from "next/server";
import {
  assertCurriculumAgentEnabled,
  listAttachableCurriculaForOwner,
} from "@/lib/curriculum/curriculum-service";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

const CURRICULUM_READ_LIMIT = 120;
const CURRICULUM_WINDOW_MS = 60_000;

// Lists the owner's curricula that can be attached as chat knowledge context
// (not archived, with a current published version). Powers the composer's
// knowledge menu; returns 404 while ENABLE_CURRICULUM_AGENT is off, which the
// client treats as "feature unavailable" and hides the section.
export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-read",
      sessionId: principal.id,
      limit: CURRICULUM_READ_LIMIT,
      windowMs: CURRICULUM_WINDOW_MS,
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

    const items = await listAttachableCurriculaForOwner(principal.id);
    return jsonWithSession({ items }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
