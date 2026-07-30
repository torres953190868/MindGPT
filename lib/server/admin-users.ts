import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { normalizeAccountPlan } from "@/lib/server/account-plan";
import {
  getSupabaseUserAccountName,
  getSupabaseUserPublicEmail,
  passwordSchema,
} from "@/lib/server/auth-password";
import { HttpError } from "@/lib/server/http";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { AdminUserDto } from "@/lib/types";

export const ADMIN_USERS_PAGE_SIZE = 50;
export const ADMIN_USERS_SEARCH_SCAN_LIMIT = 1_000;

const ADMIN_USERS_SEARCH_PAGE_SIZE = 200;

export const adminResetPasswordSchema = z.object({
  password: passwordSchema,
});

export type AdminUserListResult = {
  users: AdminUserDto[];
  total: number;
  truncated: boolean;
};

type AdminUserIdentity = {
  accountName: string | null;
  email: string | null;
};

export function filterAdminUsersByQuery<TIdentity extends AdminUserIdentity>(
  users: TIdentity[],
  query: string,
): TIdentity[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return users;

  return users.filter(
    (user) =>
      Boolean(user.accountName?.toLowerCase().includes(normalized)) ||
      Boolean(user.email?.toLowerCase().includes(normalized)),
  );
}

function requireAdminUserStorage() {
  if (!hasSupabaseServerConfig()) {
    throw new HttpError("User management requires Supabase configuration.", {
      code: "ADMIN_USERS_NOT_CONFIGURED",
      expose: true,
      status: 503,
    });
  }
}

function adminUsersLoadFailed() {
  return new HttpError("Failed to load users.", {
    code: "ADMIN_USERS_LOAD_FAILED",
    status: 500,
  });
}

function utcDateDaysAgo(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

// GoTrue cannot search users server-side, so searches scan users in pages and
// filter in memory. Scanning is capped at ADMIN_USERS_SEARCH_SCAN_LIMIT; when
// the directory is larger the result is marked truncated.
async function scanUsersForSearch() {
  const supabase = getSupabaseAdminClient();
  const users: User[] = [];
  let total = 0;
  let page = 1;

  while (users.length < ADMIN_USERS_SEARCH_SCAN_LIMIT) {
    const result = await supabase.auth.admin.listUsers({
      page,
      perPage: ADMIN_USERS_SEARCH_PAGE_SIZE,
    });
    if (result.error) throw adminUsersLoadFailed();

    total = result.data.total;
    users.push(...result.data.users);
    if (result.data.users.length < ADMIN_USERS_SEARCH_PAGE_SIZE) break;
    page += 1;
  }

  return { users, total, truncated: total > users.length };
}

async function listUsersPage(page: number, perPage: number) {
  const result = await getSupabaseAdminClient().auth.admin.listUsers({
    page,
    perPage,
  });
  if (result.error) throw adminUsersLoadFailed();

  return { users: result.data.users, total: result.data.total };
}

async function listPlanRows(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { plan: string; subscription_status: string | null; display_name: string | null }>();

  const { data, error } = await getSupabaseAdminClient()
    .from("branchmind_user_plans")
    .select("user_id, plan, subscription_status, display_name")
    .in("user_id", userIds);
  if (error) throw adminUsersLoadFailed();

  return new Map((data ?? []).map((row) => [row.user_id, row]));
}

async function listUsageRows(userIds: string[], sinceDate: string) {
  if (userIds.length === 0) return [];

  const { data, error } = await getSupabaseAdminClient()
    .from("branchmind_daily_ai_usage")
    .select("user_id, usage_date, message_count")
    .in("user_id", userIds)
    .gte("usage_date", sinceDate);
  if (error) throw adminUsersLoadFailed();

  return data ?? [];
}

function countByKey(keys: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function listProjectOwnerIds(ownerIds: string[]) {
  if (ownerIds.length === 0) return [];

  const { data, error } = await getSupabaseAdminClient()
    .from("branchmind_projects")
    .select("owner_session_id")
    .in("owner_session_id", ownerIds);
  if (error) throw adminUsersLoadFailed();

  return (data ?? []).map((row) => row.owner_session_id);
}

async function listDocumentUserIds(userIds: string[]) {
  if (userIds.length === 0) return [];

  const { data, error } = await getSupabaseAdminClient()
    .from("documents")
    .select("user_id")
    .in("user_id", userIds);
  if (error) throw adminUsersLoadFailed();

  return (data ?? []).map((row) => row.user_id);
}

export async function listAdminUsers({
  page,
  perPage = ADMIN_USERS_PAGE_SIZE,
  query = "",
}: {
  page: number;
  perPage?: number;
  query?: string;
}): Promise<AdminUserListResult> {
  requireAdminUserStorage();

  let pageUsers: User[];
  let total: number;
  let truncated = false;

  if (query.trim()) {
    const scanned = await scanUsersForSearch();
    const filtered = filterAdminUsersByQuery(
      scanned.users.map((user) => ({
        user,
        accountName: getSupabaseUserAccountName(user),
        email: getSupabaseUserPublicEmail(user),
      })),
      query,
    );
    total = filtered.length;
    truncated = scanned.truncated;
    pageUsers = filtered
      .slice((page - 1) * perPage, page * perPage)
      .map((entry) => entry.user);
  } else {
    const result = await listUsersPage(page, perPage);
    pageUsers = result.users;
    total = result.total;
  }

  const userIds = pageUsers.map((user) => user.id);
  const today = utcDateDaysAgo(0);

  const [planByUserId, usageRows, projectOwnerIds, documentUserIds] =
    await Promise.all([
      listPlanRows(userIds),
      listUsageRows(userIds, utcDateDaysAgo(29)),
      listProjectOwnerIds(userIds),
      listDocumentUserIds(userIds),
    ]);
  const projectCounts = countByKey(projectOwnerIds);
  const documentCounts = countByKey(documentUserIds);

  const usageByUserId = new Map<string, { today: number; last30Days: number }>();
  for (const row of usageRows) {
    const entry = usageByUserId.get(row.user_id) ?? { today: 0, last30Days: 0 };
    entry.last30Days += row.message_count;
    if (row.usage_date === today) entry.today += row.message_count;
    usageByUserId.set(row.user_id, entry);
  }

  const users: AdminUserDto[] = pageUsers.map((user) => {
    const planRow = planByUserId.get(user.id);
    const usage = usageByUserId.get(user.id) ?? { today: 0, last30Days: 0 };

    return {
      userId: user.id,
      accountName: getSupabaseUserAccountName(user),
      email: getSupabaseUserPublicEmail(user),
      plan: normalizeAccountPlan(planRow?.plan),
      subscriptionStatus: planRow?.subscription_status ?? "inactive",
      displayName: planRow?.display_name ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      aiMessagesToday: usage.today,
      aiMessages30d: usage.last30Days,
      projectCount: projectCounts.get(user.id) ?? 0,
      documentCount: documentCounts.get(user.id) ?? 0,
    };
  });

  return { users, total, truncated };
}

export async function resetAdminUserPassword(userId: string, password: string) {
  requireAdminUserStorage();

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    throw new HttpError("Password must be between 8 and 128 characters.", {
      code: "ADMIN_PASSWORD_INVALID",
      expose: true,
      status: 400,
    });
  }

  const { error } = await getSupabaseAdminClient().auth.admin.updateUserById(
    userId,
    { password: parsed.data },
  );

  if (error) {
    throw new HttpError("Failed to reset the user's password.", {
      code: "ADMIN_PASSWORD_RESET_FAILED",
      status: 500,
    });
  }
}
