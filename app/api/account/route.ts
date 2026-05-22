import type { NextRequest } from "next/server";
import { getBranchMindAuthContext, getOptionalSupabaseUser } from "@/lib/server/auth";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
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
    displayName: null,
    authMode: "local",
    authConfigured: false,
    plan: "free",
    subscriptionStatus: "inactive",
    usage: {
      projects: { used: projectCount, limit: 5 },
      nodes: { used: nodeCount, limit: 100 },
      documents: { used: documentCount, limit: 3 },
      aiMessages: { used: 0, limit: 50 },
    },
  };
}

async function getSupabaseAccountData(userId: string, email: string | null): Promise<AccountDto> {
  const supabase = getSupabaseAdminClient();

  // Ensure user plan exists
  const { data: existingPlan } = await supabase
    .from("branchmind_user_plans")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!existingPlan) {
    await supabase.from("branchmind_user_plans").insert({ user_id: userId, plan: "free" });
  }

  const { data: planRow, error: planError } = await supabase
    .from("branchmind_user_plans")
    .select("plan, display_name, subscription_status")
    .eq("user_id", userId)
    .single();

  if (planError) {
    throw new HttpError("Failed to load account plan.", { status: 500 });
  }

  const plan = planRow?.plan ?? "free";

  // Get plan limits
  const { data: limitRow } = await supabase
    .from("branchmind_plan_limits")
    .select("*")
    .eq("plan", plan)
    .single();

  // Get today's usage
  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await supabase
    .from("branchmind_user_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

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
    displayName: planRow?.display_name ?? null,
    authMode: "supabase",
    authConfigured: true,
    plan,
    subscriptionStatus: planRow?.subscription_status ?? "inactive",
    usage: {
      projects: { used: projectCount ?? 0, limit: limitRow?.max_projects ?? null },
      nodes: { used: nodeCount ?? 0, limit: limitRow?.max_nodes ?? null },
      documents: { used: documentCount ?? 0, limit: limitRow?.max_documents ?? null },
      aiMessages: {
        used: usageRow?.ai_message_count ?? 0,
        limit: limitRow?.max_ai_messages_per_day ?? null,
      },
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
          displayName: null,
          authMode: "local",
          authConfigured: false,
          plan: "free",
          subscriptionStatus: "inactive",
          usage: {
            projects: { used: 0, limit: 5 },
            nodes: { used: 0, limit: 100 },
            documents: { used: 0, limit: 3 },
            aiMessages: { used: 0, limit: 50 },
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
            displayName: null,
            authMode: "guest",
            authConfigured: true,
            plan: "free",
            subscriptionStatus: "inactive",
            usage: {
              projects: { used: 0, limit: 5 },
              nodes: { used: 0, limit: 100 },
              documents: { used: 0, limit: 3 },
              aiMessages: { used: 0, limit: 50 },
            },
          },
          fallbackSession,
        );
      }
      const data = await getSupabaseAccountData(user.id, user.email ?? null);
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

      const supabase = getSupabaseAdminClient();

      if (body.displayName !== undefined) {
        const { error } = await supabase
          .from("branchmind_user_plans")
          .upsert({ user_id: user.id, display_name: body.displayName });

        if (error) {
          throw new HttpError("Failed to update display name.", { status: 500 });
        }
      }

      const data = await getSupabaseAccountData(user.id, user.email ?? null);
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
