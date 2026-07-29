import { getSupabaseAccountPlanInfo } from "@/lib/server/account-plan";
import { HttpError } from "@/lib/server/http";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";

export const AI_MESSAGE_LIMIT_ERROR_CODE = "AI_MESSAGE_LIMIT_REACHED";

export type DailyAiUsageEntry = {
  date: string;
  messageCount: number;
};

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

// Daily AI usage tracking is best-effort: development databases may not have
// the branchmind_daily_ai_usage migration applied yet (PGRST205 / 42P01 style
// errors), so every helper here fails open with a warning instead of breaking
// chat or account reads.
function logDailyAiUsageFailure(step: string, userId: string, error: unknown) {
  console.warn("BranchMind daily AI usage tracking failed; skipping enforcement", {
    step,
    userId,
    table: "branchmind_daily_ai_usage",
    error,
  });
}

// Atomically increments today's counter and returns the new value, or null
// when tracking is unavailable (no Supabase config or tracking failed).
export async function incrementDailyAiMessageUsage(
  userId: string,
): Promise<number | null> {
  if (!hasSupabaseServerConfig()) return null;

  try {
    const { data, error } = await getSupabaseAdminClient().rpc(
      "increment_daily_ai_usage",
      { p_user_id: userId },
    );
    if (error) throw error;
    return typeof data === "number" ? data : null;
  } catch (error) {
    logDailyAiUsageFailure("increment", userId, error);
    return null;
  }
}

export async function getTodayAiMessageUsage(userId: string): Promise<number> {
  if (!hasSupabaseServerConfig()) return 0;

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("branchmind_daily_ai_usage")
      .select("message_count")
      .eq("user_id", userId)
      .eq("usage_date", todayUtcDate())
      .maybeSingle();
    if (error) throw error;
    return data?.message_count ?? 0;
  } catch (error) {
    logDailyAiUsageFailure("read-today", userId, error);
    return 0;
  }
}

export async function listDailyAiMessageUsage(
  userId: string,
  sinceDate: string,
): Promise<DailyAiUsageEntry[]> {
  if (!hasSupabaseServerConfig()) return [];

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("branchmind_daily_ai_usage")
      .select("usage_date, message_count")
      .eq("user_id", userId)
      .gte("usage_date", sinceDate)
      .order("usage_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      date: row.usage_date,
      messageCount: row.message_count,
    }));
  } catch (error) {
    logDailyAiUsageFailure("read-history", userId, error);
    return [];
  }
}

// Counts one AI message for the user and enforces the plan's daily limit.
// Throws a 429 HttpError only when the counter was successfully incremented
// past a finite limit; every failure mode fails open so chat never breaks
// because of usage tracking. Local-mode users are never tracked or blocked.
export async function trackDailyAiMessageUsage(principal: {
  id: string;
  authMode: "supabase" | "local";
}): Promise<void> {
  if (principal.authMode !== "supabase") return;

  const used = await incrementDailyAiMessageUsage(principal.id);
  if (used === null) return;

  const { limits } = await getSupabaseAccountPlanInfo(principal.id);
  const limit = limits.aiMessages;
  if (limit === null) return;

  if (used > limit) {
    throw new HttpError(
      "You have reached today's AI message limit. Please come back tomorrow.",
      {
        code: AI_MESSAGE_LIMIT_ERROR_CODE,
        details: { limit },
        expose: true,
        status: 429,
      },
    );
  }
}
