import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig, getSupabaseAdminClient } from "@/lib/supabase/server";

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

      const supabase = getSupabaseAdminClient();

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("branchmind_user_usage")
        .select("date, project_count, node_count, document_count, ai_message_count")
        .eq("user_id", user.id)
        .gte("date", since)
        .order("date", { ascending: false });

      if (error) {
        return jsonWithSession({ history: [] }, fallbackSession);
      }

      const history: UsageHistoryItem[] = (data ?? []).map((row) => ({
        date: row.date,
        projectCount: row.project_count,
        nodeCount: row.node_count,
        documentCount: row.document_count,
        aiMessageCount: row.ai_message_count,
      }));

      return jsonWithSession({ history }, fallbackSession);
    }

    // Local file mode - no historical tracking yet
    return jsonWithSession({ history: [] }, fallbackSession);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
