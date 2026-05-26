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
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import * as projectStore from "@/lib/server/projects-store";
import { getRagRepository } from "@/lib/server/rag/store";
import { parseJsonBody } from "@/lib/server/validation";
import { z } from "zod";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

const updateAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
});

export type AccountDto = {
  email: string | null;
  accountName: string | null;
  displayName: string | null;
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

  return {
    email,
    accountName,
    displayName: planInfo.displayName,
    authMode: "supabase",
    authConfigured: true,
    plan: planInfo.plan,
    subscriptionStatus: planInfo.subscriptionStatus,
    usage: {
      projects: { used: projectCount ?? 0, limit: planInfo.limits.projects },
      nodes: { used: nodeCount, limit: planInfo.limits.nodes },
      documents: { used: documentCount ?? 0, limit: planInfo.limits.documents },
      aiMessages: { used: 0, limit: planInfo.limits.aiMessages },
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
    const body = await parseJsonBody(request, updateAccountSchema, { maxBytes: 8 * 1024 });

    if (hasSupabaseServerConfig()) {
      const user = await getOptionalSupabaseUser();
      if (!user) {
        throw new HttpError("Sign in is required.", { code: "AUTH_REQUIRED", expose: true, status: 401 });
      }

      const data = await getSupabaseAccountData(user);
      return jsonWithSession(
        body.displayName !== undefined ? { ...data, displayName: body.displayName } : data,
        fallbackSession,
      );
    }

    // Local file mode - no-op but return success
    const { principal, session } = await getBranchMindAuthContext(request);
    const data = await getFileAccountData(principal.id);
    return jsonWithSession(data, session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
