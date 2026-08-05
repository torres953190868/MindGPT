import type { NextRequest } from "next/server";
import { assertCurriculumAgentEnabled } from "@/lib/curriculum/curriculum-service";
import { getAccountPlanForModelAccess } from "@/lib/server/account-plan";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getMonthlyCurriculumGenerationQuota } from "@/lib/server/curriculum-generation-quota";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { getOrCreateSession } from "@/lib/server/session";

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertCurriculumAgentEnabled();
    const { principal, session } = await getBranchMindAuthContext(request);
    const rateLimit = await checkRateLimitAsync(request, {
      action: "curriculum-read",
      sessionId: principal.id,
      limit: 120,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return jsonWithSession({ error: "Too many requests." }, session, {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }

    const plan = await getAccountPlanForModelAccess(principal);
    const quota = await getMonthlyCurriculumGenerationQuota({ ...principal, plan });
    return jsonWithSession({ quota }, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
