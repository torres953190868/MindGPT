import type { User } from "@supabase/supabase-js";
import { normalizeAccountPlan } from "@/lib/server/account-plan";
import { getSupabaseUserAccountName } from "@/lib/server/auth-password";
import { HttpError } from "@/lib/server/http";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import type {
  AdminAnalyticsActivityDay,
  AdminAnalyticsBranchSplit,
  AdminAnalyticsDailyPoint,
  AdminAnalyticsDto,
  AdminAnalyticsPlanDistribution,
} from "@/lib/types";

export const ADMIN_ANALYTICS_USER_SCAN_LIMIT = 5_000;

const ADMIN_ANALYTICS_USER_PAGE_SIZE = 1_000;
const TOP_USER_LIMIT = 10;
const WAU_WINDOW_DAYS = 7;

export type DailyUsageRow = {
  userId: string;
  date: string;
  messageCount: number;
};

export function toUtcDateKey(timestamp: string) {
  return timestamp.slice(0, 10);
}

export function listUtcDatesEndingToday(rangeDays: number, now = new Date()) {
  const end = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

  return Array.from({ length: rangeDays }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - (rangeDays - 1 - index));
    return day.toISOString().slice(0, 10);
  });
}

export function bucketCountsByDate(
  dates: string[],
  timestamps: string[],
): AdminAnalyticsDailyPoint[] {
  const inRange = new Set(dates);
  const counts = new Map<string, number>();

  for (const timestamp of timestamps) {
    const date = toUtcDateKey(timestamp);
    if (!inRange.has(date)) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

export function countPlans(
  plans: Array<string | null | undefined>,
): AdminAnalyticsPlanDistribution {
  const distribution: AdminAnalyticsPlanDistribution = { free: 0, pro: 0, max: 0 };
  for (const plan of plans) {
    distribution[normalizeAccountPlan(plan)] += 1;
  }
  return distribution;
}

export function countSubscriptionStatuses(
  statuses: Array<string | null | undefined>,
) {
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    const key = status?.trim() || "inactive";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function countDistinctUsers(
  rows: Array<{ userId: string; date: string }>,
  sinceDate: string,
) {
  const users = new Set<string>();
  for (const row of rows) {
    if (row.date >= sinceDate) users.add(row.userId);
  }
  return users.size;
}

export function summarizeDailyActivity(
  rows: DailyUsageRow[],
  dates: string[],
): AdminAnalyticsActivityDay[] {
  const byDate = new Map<string, { users: Set<string>; messages: number }>();

  for (const row of rows) {
    const entry = byDate.get(row.date) ?? { users: new Set<string>(), messages: 0 };
    entry.users.add(row.userId);
    entry.messages += row.messageCount;
    byDate.set(row.date, entry);
  }

  return dates.map((date) => {
    const entry = byDate.get(date);
    return {
      date,
      activeUsers: entry?.users.size ?? 0,
      messages: entry?.messages ?? 0,
    };
  });
}

export function rankTopUsers(rows: DailyUsageRow[], limit = TOP_USER_LIMIT) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.messageCount);
  }

  return [...totals.entries()]
    .map(([userId, messages]) => ({ userId, messages }))
    .sort((a, b) => b.messages - a.messages || a.userId.localeCompare(b.userId))
    .slice(0, limit);
}

export function computeBranchSplit(
  continueCount: number,
  branchCount: number,
): AdminAnalyticsBranchSplit {
  const total = continueCount + branchCount;

  return {
    continueCount,
    branchCount,
    continueShare: total > 0 ? continueCount / total : 0,
    branchShare: total > 0 ? branchCount / total : 0,
  };
}

function requireAdminAnalyticsStorage() {
  if (!hasSupabaseServerConfig()) {
    throw new HttpError("Analytics require Supabase configuration.", {
      code: "ADMIN_ANALYTICS_NOT_CONFIGURED",
      expose: true,
      status: 503,
    });
  }
}

function adminAnalyticsLoadFailed() {
  return new HttpError("Failed to load analytics.", {
    code: "ADMIN_ANALYTICS_LOAD_FAILED",
    status: 500,
  });
}

async function scanUsersForAnalytics() {
  const supabase = getSupabaseAdminClient();
  const users: User[] = [];
  let total = 0;
  let page = 1;

  while (users.length < ADMIN_ANALYTICS_USER_SCAN_LIMIT) {
    const result = await supabase.auth.admin.listUsers({
      page,
      perPage: ADMIN_ANALYTICS_USER_PAGE_SIZE,
    });
    if (result.error) throw adminAnalyticsLoadFailed();

    total = result.data.total;
    users.push(...result.data.users);
    if (result.data.users.length < ADMIN_ANALYTICS_USER_PAGE_SIZE) break;
    page += 1;
  }

  return { users, total };
}

export async function getAdminAnalytics(
  rangeDays: 7 | 30,
): Promise<AdminAnalyticsDto> {
  requireAdminAnalyticsStorage();

  const supabase = getSupabaseAdminClient();
  const dates = listUtcDatesEndingToday(rangeDays);
  const sinceDate = dates[0];
  const today = dates[dates.length - 1];
  const wauSinceDate = dates[Math.max(dates.length - WAU_WINDOW_DAYS, 0)];

  const [
    userScan,
    projectsHead,
    nodesHead,
    userMessagesHead,
    documentsHead,
    continueHead,
    branchHead,
    plansResult,
    usageResult,
    projectsResult,
    nodesResult,
    documentsResult,
  ] = await Promise.all([
    scanUsersForAnalytics(),
    supabase.from("branchmind_projects").select("*", { count: "exact", head: true }),
    supabase.from("branchmind_nodes").select("*", { count: "exact", head: true }),
    supabase
      .from("branchmind_messages")
      .select("*", { count: "exact", head: true })
      .eq("role", "user"),
    supabase.from("documents").select("*", { count: "exact", head: true }),
    supabase
      .from("branchmind_nodes")
      .select("*", { count: "exact", head: true })
      .eq("branch_type", "continue"),
    supabase
      .from("branchmind_nodes")
      .select("*", { count: "exact", head: true })
      .eq("branch_type", "branch"),
    supabase.from("branchmind_user_plans").select("user_id, plan, subscription_status"),
    supabase
      .from("branchmind_daily_ai_usage")
      .select("user_id, usage_date, message_count")
      .gte("usage_date", sinceDate),
    supabase.from("branchmind_projects").select("created_at").gte("created_at", sinceDate),
    supabase.from("branchmind_nodes").select("created_at").gte("created_at", sinceDate),
    supabase.from("documents").select("created_at").gte("created_at", sinceDate),
  ]);

  for (const result of [
    projectsHead,
    nodesHead,
    userMessagesHead,
    documentsHead,
    continueHead,
    branchHead,
    plansResult,
    usageResult,
    projectsResult,
    nodesResult,
    documentsResult,
  ]) {
    if (result.error) throw adminAnalyticsLoadFailed();
  }

  const planByUserId = new Map(
    (plansResult.data ?? []).map((row) => [row.user_id, row]),
  );
  const accountNameByUserId = new Map(
    userScan.users.map((user) => [user.id, getSupabaseUserAccountName(user)]),
  );
  const usageRows: DailyUsageRow[] = (usageResult.data ?? []).map((row) => ({
    userId: row.user_id,
    date: row.usage_date,
    messageCount: row.message_count,
  }));

  return {
    rangeDays,
    generatedAt: new Date().toISOString(),
    totals: {
      users: userScan.total,
      projects: projectsHead.count ?? 0,
      nodes: nodesHead.count ?? 0,
      userMessages: userMessagesHead.count ?? 0,
      documents: documentsHead.count ?? 0,
    },
    growth: {
      signups: bucketCountsByDate(
        dates,
        userScan.users.map((user) => user.created_at),
      ),
      planDistribution: countPlans(
        userScan.users.map((user) => planByUserId.get(user.id)?.plan),
      ),
      subscriptionStatusCounts: countSubscriptionStatuses(
        userScan.users.map((user) => planByUserId.get(user.id)?.subscription_status),
      ),
    },
    activity: {
      dau: countDistinctUsers(usageRows, today),
      wau: countDistinctUsers(usageRows, wauSinceDate),
      dailyActive: summarizeDailyActivity(usageRows, dates),
      topUsers: rankTopUsers(usageRows).map((entry) => ({
        ...entry,
        accountName: accountNameByUserId.get(entry.userId) ?? null,
      })),
    },
    features: {
      branchSplit: computeBranchSplit(
        continueHead.count ?? 0,
        branchHead.count ?? 0,
      ),
      dailyProjects: bucketCountsByDate(
        dates,
        (projectsResult.data ?? []).map((row) => row.created_at),
      ),
      dailyNodes: bucketCountsByDate(
        dates,
        (nodesResult.data ?? []).map((row) => row.created_at),
      ),
      dailyDocuments: bucketCountsByDate(
        dates,
        (documentsResult.data ?? []).map((row) => row.created_at),
      ),
    },
  };
}
