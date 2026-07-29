import type { NextRequest } from "next/server";
import { getBranchMindAuthContext, getOptionalSupabaseUser } from "@/lib/server/auth";
import {
  getSupabaseUserAccountName,
  getSupabaseUserPublicEmail,
} from "@/lib/server/auth-password";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import {
  DEFAULT_ACCOUNT_PLAN,
  DEFAULT_PLAN_LIMITS,
  PLAN_LIMITS_DISABLED,
  getSupabaseAccountPlanInfo,
} from "@/lib/server/account-plan";
import { getTodayAiMessageUsage } from "@/lib/server/ai-usage";
import { BUG_REPORT_ATTACHMENT_BUCKET } from "@/lib/server/bug-reports";
import { checkRateLimitAsync } from "@/lib/server/rate-limit";
import { createRequestId } from "@/lib/server/request";
import { assertValidRequestOrigin } from "@/lib/server/security";
import {
  SESSION_COOKIE_NAME,
  getExistingSessionId,
  getOrCreateSession,
} from "@/lib/server/session";
import {
  createSupabaseCookieClient,
  hasSupabaseServerConfig,
  getSupabaseAdminClient,
} from "@/lib/supabase/server";
import * as projectStore from "@/lib/server/projects-store";
import { getRagRepository } from "@/lib/server/rag/store";
import { parseJsonBody } from "@/lib/server/validation";
import { DEFAULT_LANGUAGE, getBranchMindLanguage, type BranchMindLanguage } from "@/lib/language";
import { z } from "zod";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

const PATCH_ACCOUNT_LIMIT = 120;
const PATCH_ACCOUNT_WINDOW_MS = 60_000;

const DELETE_ACCOUNT_LIMIT = 5;
const DELETE_ACCOUNT_WINDOW_MS = 10 * 60_000;

const updateAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  languagePreference: z.enum(["zh", "en"]).optional(),
});

export type AccountDto = {
  email: string | null;
  accountName: string | null;
  displayName: string | null;
  languagePreference: BranchMindLanguage;
  authMode: "supabase" | "local" | "guest";
  authConfigured: boolean;
  plan: string;
  subscriptionStatus: string | null;
  usage: {
    projects: { used: number; limit: number | null };
    nodes: { used: number; limit: number | null };
    documents: { used: number; limit: number | null };
    aiMessages: { used: number; limit: number | null };
  };
};

async function getFileAccountData(sessionId: string): Promise<AccountDto> {
  const projects = await projectStore.readProjectsForSession(sessionId);
  const projectCount = projects.length;
  const nodeCount = projects.reduce((sum, p) => sum + Object.keys(p.nodes).length, 0);

  const ragRepo = getRagRepository();
  const documents = await ragRepo.listDocuments(sessionId);
  const documentCount = documents.length;

  return {
    email: null,
    accountName: null,
    displayName: null,
    languagePreference: DEFAULT_LANGUAGE,
    authMode: "local",
    authConfigured: false,
    plan: "unlimited",
    subscriptionStatus: "inactive",
    usage: {
      projects: { used: projectCount, limit: PLAN_LIMITS_DISABLED.projects },
      nodes: { used: nodeCount, limit: PLAN_LIMITS_DISABLED.nodes },
      documents: { used: documentCount, limit: PLAN_LIMITS_DISABLED.documents },
      aiMessages: { used: 0, limit: PLAN_LIMITS_DISABLED.aiMessages },
    },
  };
}

type SupabaseAccountUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

async function getSupabaseAccountData(user: SupabaseAccountUser): Promise<AccountDto> {
  const supabase = getSupabaseAdminClient();
  const userId = user.id;
  const email = getSupabaseUserPublicEmail(user);
  const accountName = getSupabaseUserAccountName(user);
  const planInfo = await getSupabaseAccountPlanInfo(userId);

  // Count actual resources
  const { count: projectCount } = await supabase
    .from("branchmind_projects")
    .select("*", { count: "exact", head: true })
    .eq("owner_session_id", userId);

  const { data: userProjectIds } = await supabase
    .from("branchmind_projects")
    .select("id")
    .eq("owner_session_id", userId);

  const projectIdList = (userProjectIds ?? []).map((p) => p.id);

  let nodeCount = 0;
  if (projectIdList.length > 0) {
    const { count } = await supabase
      .from("branchmind_nodes")
      .select("*", { count: "exact", head: true })
      .in("project_id", projectIdList);
    nodeCount = count ?? 0;
  }

  const { count: documentCount } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  // Best-effort: returns 0 when the daily usage table is not migrated yet.
  const aiMessagesUsed = await getTodayAiMessageUsage(userId);

  return {
    email,
    accountName,
    displayName: planInfo.displayName,
    languagePreference: planInfo.languagePreference,
    authMode: "supabase",
    authConfigured: true,
    plan: planInfo.plan,
    subscriptionStatus: planInfo.subscriptionStatus,
    usage: {
      projects: { used: projectCount ?? 0, limit: planInfo.limits.projects },
      nodes: { used: nodeCount, limit: planInfo.limits.nodes },
      documents: { used: documentCount ?? 0, limit: planInfo.limits.documents },
      aiMessages: { used: aiMessagesUsed, limit: planInfo.limits.aiMessages },
    },
  };
}

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession(
        {
          email: null,
          accountName: null,
          displayName: null,
          languagePreference: DEFAULT_LANGUAGE,
          authMode: "local",
          authConfigured: false,
          plan: "unlimited",
          subscriptionStatus: "inactive",
          usage: {
            projects: { used: 0, limit: PLAN_LIMITS_DISABLED.projects },
            nodes: { used: 0, limit: PLAN_LIMITS_DISABLED.nodes },
            documents: { used: 0, limit: PLAN_LIMITS_DISABLED.documents },
            aiMessages: { used: 0, limit: PLAN_LIMITS_DISABLED.aiMessages },
          },
        },
        READ_ONLY_LOCAL_SESSION,
      );
    }

    if (hasSupabaseServerConfig()) {
      const user = await getOptionalSupabaseUser();
      if (!user) {
        return jsonWithSession(
          {
            email: null,
            accountName: null,
            displayName: null,
            languagePreference: DEFAULT_LANGUAGE,
            authMode: "guest",
            authConfigured: true,
            plan: DEFAULT_ACCOUNT_PLAN,
            subscriptionStatus: "inactive",
            usage: {
              projects: { used: 0, limit: DEFAULT_PLAN_LIMITS.free.projects },
              nodes: { used: 0, limit: DEFAULT_PLAN_LIMITS.free.nodes },
              documents: { used: 0, limit: DEFAULT_PLAN_LIMITS.free.documents },
              aiMessages: { used: 0, limit: DEFAULT_PLAN_LIMITS.free.aiMessages },
            },
          },
          fallbackSession,
        );
      }
      const data = await getSupabaseAccountData(user);
      return jsonWithSession(data, fallbackSession);
    }

    // Local file mode
    const { principal, session } = await getBranchMindAuthContext(request);
    const data = await getFileAccountData(principal.id);
    return jsonWithSession(data, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

export async function PATCH(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const body = await parseJsonBody(request, updateAccountSchema, { maxBytes: 8 * 1024 });

    if (hasSupabaseServerConfig()) {
      const user = await getOptionalSupabaseUser();
      if (!user) {
        throw new HttpError("Sign in is required.", { code: "AUTH_REQUIRED", expose: true, status: 401 });
      }

      const rateLimit = await checkRateLimitAsync(request, {
        action: "patch-account",
        sessionId: user.id,
        limit: PATCH_ACCOUNT_LIMIT,
        windowMs: PATCH_ACCOUNT_WINDOW_MS,
      });
      if (!rateLimit.allowed) {
        return jsonWithSession(
          { error: "Too many requests." },
          fallbackSession,
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        );
      }

      if (body.displayName !== undefined || body.languagePreference !== undefined) {
        const updatePayload: {
          user_id: string;
          updated_at: string;
          display_name?: string | null;
          language_preference?: BranchMindLanguage;
        } = {
          user_id: user.id,
          updated_at: new Date().toISOString(),
        };

        if (body.displayName !== undefined) updatePayload.display_name = body.displayName;
        if (body.languagePreference !== undefined) {
          updatePayload.language_preference = getBranchMindLanguage(body.languagePreference);
        }

        const { error } = await getSupabaseAdminClient()
          .from("branchmind_user_plans")
          .upsert(updatePayload, { onConflict: "user_id" });

        if (error) {
          throw new HttpError("Failed to update account.", {
            code: "ACCOUNT_UPDATE_FAILED",
            expose: true,
            status: 500,
          });
        }
      }

      const data = await getSupabaseAccountData(user);
      return jsonWithSession(data, fallbackSession);
    }

    // Local file mode - no-op but return success
    const { principal, session } = await getBranchMindAuthContext(request);
    const data = await getFileAccountData(principal.id);
    return jsonWithSession(data, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}

function logAccountDeletionFailure(requestId: string, step: string, error: unknown) {
  console.error("BranchMind account deletion step failed", {
    requestId,
    step,
    message: error instanceof Error ? error.message : String(error),
  });
}

function accountDeletionFailed(step: string, requestId: string, error: unknown): never {
  logAccountDeletionFailure(requestId, step, error);
  throw new HttpError("Failed to delete account.", {
    code: "ACCOUNT_DELETE_FAILED",
    status: 500,
  });
}

// Removes every row and file owned by the user, then deletes the auth user.
// FK cascade notes (see supabase/migrations):
// - branchmind_nodes / branchmind_messages cascade from branchmind_projects.
// - document_pages / document_sections / document_chunks cascade from documents.
// - branchmind_user_plans / branchmind_user_usage / branchmind_daily_ai_usage
//   cascade from auth.users.
// - branchmind_bug_reports would only SET NULL reporter_user_id, so its rows
//   (and screenshot files) are deleted explicitly instead.
async function deleteSupabaseAccountData(userId: string, requestId: string) {
  const supabase = getSupabaseAdminClient();

  try {
    const { error } = await supabase
      .from("branchmind_projects")
      .delete()
      .eq("owner_session_id", userId);
    if (error) throw error;
  } catch (error) {
    accountDeletionFailed("projects", requestId, error);
  }

  try {
    const ragRepo = getRagRepository();
    const documents = await ragRepo.listDocuments(userId);
    for (const document of documents) {
      // deleteDocument also removes the stored PDF (Supabase Storage or disk).
      await ragRepo.deleteDocument(document);
    }
  } catch (error) {
    accountDeletionFailed("documents", requestId, error);
  }

  let screenshotPaths: string[] = [];
  try {
    const { data: reportRows, error: reportsError } = await supabase
      .from("branchmind_bug_reports")
      .select("screenshot_path")
      .eq("reporter_user_id", userId);
    if (reportsError) throw reportsError;
    screenshotPaths = (reportRows ?? [])
      .map((row) => row.screenshot_path)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const { error } = await supabase
      .from("branchmind_bug_reports")
      .delete()
      .eq("reporter_user_id", userId);
    if (error) throw error;
  } catch (error) {
    accountDeletionFailed("bug-reports", requestId, error);
  }

  if (screenshotPaths.length > 0) {
    const { error } = await supabase.storage
      .from(BUG_REPORT_ATTACHMENT_BUCKET)
      .remove(screenshotPaths);
    // Orphaned screenshot files are harmless; keep deleting the account.
    if (error) logAccountDeletionFailure(requestId, "bug-report-screenshots", error);
  }

  // Ephemeral rate-limit rows expire on their own, so cleanup is best-effort.
  const { error: rateLimitError } = await supabase
    .from("rate_limits")
    .delete()
    .eq("session_id", userId);
  if (rateLimitError) logAccountDeletionFailure(requestId, "rate-limits", rateLimitError);

  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
  } catch (error) {
    accountDeletionFailed("auth-user", requestId, error);
  }
}

export async function DELETE(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);
  const requestId = createRequestId();

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    if (hasSupabaseServerConfig()) {
      const user = await getOptionalSupabaseUser();
      if (!user) {
        throw new HttpError("Sign in is required.", { code: "AUTH_REQUIRED", expose: true, status: 401 });
      }

      const rateLimit = await checkRateLimitAsync(request, {
        action: "delete-account",
        sessionId: user.id,
        limit: DELETE_ACCOUNT_LIMIT,
        windowMs: DELETE_ACCOUNT_WINDOW_MS,
      });
      if (!rateLimit.allowed) {
        return jsonWithSession(
          { error: "Too many requests." },
          fallbackSession,
          {
            status: 429,
            headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
          },
        );
      }

      await deleteSupabaseAccountData(user.id, requestId);

      // The account is gone; drop the auth cookies. Sign-out failure must not
      // turn a successful deletion into an error response.
      try {
        const supabase = await createSupabaseCookieClient();
        await supabase.auth.signOut();
      } catch (error) {
        logAccountDeletionFailure(requestId, "sign-out", error);
      }

      return jsonWithSession({ ok: true }, fallbackSession);
    }

    // Local file mode: there is no account, so wipe everything owned by this
    // browser session and expire the session cookie.
    const sessionId = getExistingSessionId(request);
    if (!sessionId) {
      throw new HttpError("Sign in is required.", { code: "AUTH_REQUIRED", expose: true, status: 401 });
    }

    const rateLimit = await checkRateLimitAsync(request, {
      action: "delete-account",
      sessionId,
      limit: DELETE_ACCOUNT_LIMIT,
      windowMs: DELETE_ACCOUNT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return jsonWithSession(
        { error: "Too many requests." },
        fallbackSession,
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    await projectStore.updateProjects((projects) =>
      projects.filter((project) => !projectStore.projectBelongsToSession(project, sessionId)),
    );

    const ragRepo = getRagRepository();
    const documents = await ragRepo.listDocuments(sessionId);
    for (const document of documents) {
      await ragRepo.deleteDocument(document);
    }

    const response = jsonWithSession({ ok: true }, { id: sessionId, isNew: false });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession, { requestId });
  }
}
