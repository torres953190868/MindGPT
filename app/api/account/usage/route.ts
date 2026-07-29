import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import { listDailyAiMessageUsage } from "@/lib/server/ai-usage";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

export type UsageHistoryItem = {
  date: string;
  projectCount: number;
  nodeCount: number;
  documentCount: number;
  aiMessageCount: number;
};

export type AccountUsageDto = {
  history: UsageHistoryItem[];
};

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession({ history: [] }, READ_ONLY_LOCAL_SESSION);
    }

    if (hasSupabaseServerConfig()) {
      const user = await getOptionalSupabaseUser();
      if (!user) {
        return jsonWithSession({ history: [] }, fallbackSession);
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString().slice(0, 10);

      // Only AI messages are tracked per day so far; the other counters stay
      // at zero until they get their own daily tracking. Fails open to an
      // empty history when the usage table is not migrated yet.
      const entries = await listDailyAiMessageUsage(user.id, since);

      const history: UsageHistoryItem[] = entries.map((entry) => ({
        date: entry.date,
        projectCount: 0,
        nodeCount: 0,
        documentCount: 0,
        aiMessageCount: entry.messageCount,
      }));

      return jsonWithSession({ history }, fallbackSession);
    }

    // Local file mode - no historical tracking yet
    return jsonWithSession({ history: [] }, fallbackSession);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
