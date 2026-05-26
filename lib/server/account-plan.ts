import { getSupabaseAdminClient } from "@/lib/supabase/server";

export type AccountPlan = "free" | "pro" | "team";

export const DEFAULT_ACCOUNT_PLAN: AccountPlan = "free";

export const DEFAULT_PLAN_LIMITS: Record<
  AccountPlan,
  {
    projects: number | null;
    nodes: number | null;
    documents: number | null;
    aiMessages: number | null;
  }
> = {
  free: {
    projects: 5,
    nodes: 100,
    documents: 3,
    aiMessages: 50,
  },
  pro: {
    projects: null,
    nodes: null,
    documents: 50,
    aiMessages: 500,
  },
  team: {
    projects: null,
    nodes: null,
    documents: null,
    aiMessages: null,
  },
};

export const PLAN_LIMITS_DISABLED = {
  projects: null,
  nodes: null,
  documents: null,
  aiMessages: null,
} as const;

const ACCOUNT_PLANS = new Set<AccountPlan>(["free", "pro", "team"]);
const FREE_PLAN_DEEPSEEK_MODELS = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);

export type SupabaseAccountPlanInfo = {
  plan: AccountPlan;
  displayName: string | null;
  subscriptionStatus: string | null;
  limits: (typeof DEFAULT_PLAN_LIMITS)[AccountPlan];
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeAccountPlan(value: string | null | undefined): AccountPlan {
  const plan = clean(value)?.toLowerCase();
  return plan && ACCOUNT_PLANS.has(plan as AccountPlan)
    ? (plan as AccountPlan)
    : DEFAULT_ACCOUNT_PLAN;
}

export function isAccountPlanModelRestricted(plan: string | null | undefined) {
  return plan !== undefined && normalizeAccountPlan(plan) === "free";
}

export function isModelAllowedForAccountPlan(
  plan: string | null | undefined,
  providerId: string,
  model: string,
) {
  if (!isAccountPlanModelRestricted(plan)) return true;

  return (
    providerId.trim().toLowerCase() === "deepseek" &&
    FREE_PLAN_DEEPSEEK_MODELS.has(model.trim())
  );
}

async function ensureSupabaseFreePlan(userId: string) {
  const { error } = await getSupabaseAdminClient()
    .from("branchmind_user_plans")
    .upsert(
      {
        user_id: userId,
        plan: DEFAULT_ACCOUNT_PLAN,
      },
      {
        onConflict: "user_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error("BranchMind user free plan initialization failed", error);
  }
}

function defaultPlanInfo(plan = DEFAULT_ACCOUNT_PLAN): SupabaseAccountPlanInfo {
  return {
    plan,
    displayName: null,
    subscriptionStatus: "inactive",
    limits: DEFAULT_PLAN_LIMITS[plan],
  };
}

export async function getSupabaseAccountPlanInfo(
  userId: string,
): Promise<SupabaseAccountPlanInfo> {
  const supabase = getSupabaseAdminClient();
  const { data: planRow, error: planError } = await supabase
    .from("branchmind_user_plans")
    .select("plan, display_name, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (planError) {
    console.error("BranchMind user plan lookup failed", planError);
    return defaultPlanInfo();
  }

  if (!planRow) {
    await ensureSupabaseFreePlan(userId);
    return defaultPlanInfo();
  }

  const plan = normalizeAccountPlan(planRow.plan);
  const { data: limitsRow, error: limitsError } = await supabase
    .from("branchmind_plan_limits")
    .select("max_projects, max_nodes, max_documents, max_ai_messages_per_day")
    .eq("plan", plan)
    .maybeSingle();

  if (limitsError) {
    console.error("BranchMind plan limits lookup failed", limitsError);
  }

  return {
    plan,
    displayName: planRow.display_name ?? null,
    subscriptionStatus: planRow.subscription_status ?? "inactive",
    limits: limitsRow
      ? {
          projects: limitsRow.max_projects,
          nodes: limitsRow.max_nodes,
          documents: limitsRow.max_documents,
          aiMessages: limitsRow.max_ai_messages_per_day,
        }
      : DEFAULT_PLAN_LIMITS[plan],
  };
}

export async function getAccountPlanForModelAccess(principal: {
  id: string;
  authMode: "supabase" | "local";
}) {
  if (principal.authMode !== "supabase") return undefined;
  return (await getSupabaseAccountPlanInfo(principal.id)).plan;
}
