import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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
  agentTokensTotal?: number;
  agentRunsCount?: number;
};

export type IncrementDailyAgentUsageInput = {
  userId: string;
  tokens: number;
  runsCount: number;
};

type FileDailyAiUsageEntry = DailyAiUsageEntry & { userId: string };
type FileDailyAiUsage = { version: 1; entries: FileDailyAiUsageEntry[] };

function usageDataFile() {
  return path.join(
    process.env.BRANCHMIND_AI_USAGE_DATA_DIR?.trim() || path.join(process.cwd(), "data"),
    "branchmind-ai-usage.json",
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function shouldUseSupabaseAiUsage() {
  const backend = process.env.BRANCHMIND_AI_USAGE_BACKEND?.trim().toLowerCase();
  if (backend === "file") return false;
  if (backend === "supabase") return true;
  return hasSupabaseServerConfig() && process.env.BRANCHMIND_CURRICULUM_BACKEND !== "file";
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

async function readFileDailyAiUsage(): Promise<FileDailyAiUsage> {
  try {
    const parsed = JSON.parse(await readFile(usageDataFile(), "utf8")) as Partial<FileDailyAiUsage>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

async function writeFileDailyAiUsage(data: FileDailyAiUsage) {
  const filePath = usageDataFile();
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

let fileUsageWriteQueue: Promise<unknown> = Promise.resolve();

function mutateFileDailyAiUsage<T>(mutator: (data: FileDailyAiUsage) => T | Promise<T>) {
  const next = fileUsageWriteQueue.then(async () => {
    const data = await readFileDailyAiUsage();
    const result = await mutator(data);
    await writeFileDailyAiUsage(data);
    return result;
  });
  fileUsageWriteQueue = next.catch(() => undefined);
  return next;
}

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
  if (!shouldUseSupabaseAiUsage()) {
    const data = await readFileDailyAiUsage();
    return data.entries
      .filter((entry) => entry.userId === userId && entry.date >= sinceDate)
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((entry) => ({
        date: entry.date,
        messageCount: entry.messageCount,
        agentTokensTotal: entry.agentTokensTotal,
        agentRunsCount: entry.agentRunsCount,
      }));
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("branchmind_daily_ai_usage")
      .select("usage_date, message_count, agent_tokens_total, agent_runs_count")
      .eq("user_id", userId)
      .gte("usage_date", sinceDate)
      .order("usage_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => {
      const entry: DailyAiUsageEntry = {
        date: row.usage_date,
        messageCount: row.message_count,
      };
      if ("agent_tokens_total" in row) entry.agentTokensTotal = row.agent_tokens_total ?? 0;
      if ("agent_runs_count" in row) entry.agentRunsCount = row.agent_runs_count ?? 0;
      return entry;
    });
  } catch (error) {
    logDailyAiUsageFailure("read-history", userId, error);
    return [];
  }
}

/**
 * Aggregates non-message agent usage for the current UTC day. This is
 * deliberately best-effort like the existing message counter: a missing
 * migration or unavailable local store must never break a completed run.
 */
export async function incrementDailyAgentUsage(
  input: IncrementDailyAgentUsageInput,
): Promise<void> {
  const tokens = nonNegativeInteger(input.tokens);
  const runsCount = nonNegativeInteger(input.runsCount);
  if (!input.userId.trim() || (tokens === 0 && runsCount === 0)) return;

  if (shouldUseSupabaseAiUsage()) {
    try {
      const { error } = await getSupabaseAdminClient().rpc("increment_daily_agent_usage", {
        p_user_id: input.userId,
        p_tokens: tokens,
        p_runs_count: runsCount,
      });
      if (error) throw error;
      return;
    } catch (error) {
      logDailyAiUsageFailure("increment-agent", input.userId, error);
      return;
    }
  }

  try {
    await mutateFileDailyAiUsage((data) => {
      const date = todayUtcDate();
      const existing = data.entries.find(
        (entry) => entry.userId === input.userId && entry.date === date,
      );
      if (existing) {
        existing.agentTokensTotal = (existing.agentTokensTotal ?? 0) + tokens;
        existing.agentRunsCount = (existing.agentRunsCount ?? 0) + runsCount;
        return;
      }
      data.entries.push({
        userId: input.userId,
        date,
        messageCount: 0,
        agentTokensTotal: tokens,
        agentRunsCount: runsCount,
      });
    });
  } catch (error) {
    logDailyAiUsageFailure("increment-agent-file", input.userId, error);
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
