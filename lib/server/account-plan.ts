import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";
import { DEFAULT_LANGUAGE, getBranchMindLanguage, type BranchMindLanguage } from "@/lib/language";

export type AccountPlan = "free" | "pro" | "max";

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
  max: {
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

const ACCOUNT_PLANS = new Set<AccountPlan>(["free", "pro", "max"]);
const FREE_PLAN_MODEL_ACCESS = [
  { providerId: "deepseek", model: "deepseek-v4-flash" },
] as const;

export type PlanModelAccess = {
  plan: AccountPlan;
  providerId: string;
  model: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SupabaseAccountPlanInfo = {
  plan: AccountPlan;
  displayName: string | null;
  languagePreference: BranchMindLanguage;
  subscriptionStatus: string | null;
  limits: (typeof DEFAULT_PLAN_LIMITS)[AccountPlan];
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeAccountPlan(value: string | null | undefined): AccountPlan {
  const plan = clean(value)?.toLowerCase();
  if (plan === "team") return "max";
  return plan && ACCOUNT_PLANS.has(plan as AccountPlan)
    ? (plan as AccountPlan)
    : DEFAULT_ACCOUNT_PLAN;
}

export function isAccountPlanModelRestricted(plan: string | null | undefined) {
  return plan != null && normalizeAccountPlan(plan) === "free";
}

export function isModelAllowedForAccountPlan(
  plan: string | null | undefined,
  providerId: string,
  model: string,
) {
  if (!isAccountPlanModelRestricted(plan)) return true;

  return FREE_PLAN_MODEL_ACCESS.some(
    (access) =>
      access.providerId === providerId.trim().toLowerCase() &&
      access.model === model.trim(),
  );
}

function getStaticFreePlanModelAccess(): PlanModelAccess[] {
  return FREE_PLAN_MODEL_ACCESS.map((access) => ({
    plan: "free",
    providerId: access.providerId,
    model: access.model,
  }));
}

export function isModelAllowedByPlanAccess(
  accessList: PlanModelAccess[],
  providerId: string,
  model: string,
) {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModel = model.trim();
  return accessList.some(
    (access) =>
      access.providerId.trim().toLowerCase() === normalizedProviderId &&
      access.model.trim() === normalizedModel,
  );
}

export async function getPlanModelAccess(
  plan: string | null | undefined,
): Promise<PlanModelAccess[]> {
  if (!isAccountPlanModelRestricted(plan)) return [];

  const normalizedPlan = normalizeAccountPlan(plan);

  if (!hasSupabaseServerConfig()) {
    return getStaticFreePlanModelAccess();
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("branchmind_plan_model_access")
      .select("plan, provider_id, model, created_at, updated_at")
      .eq("plan", normalizedPlan);

    if (error) throw error;

    if (!data || data.length === 0) {
      return getStaticFreePlanModelAccess();
    }

    return data.map((row) => ({
      plan: row.plan as AccountPlan,
      providerId: row.provider_id,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    console.error("BranchMind plan model access lookup failed", {
      plan: normalizedPlan,
      table: "branchmind_plan_model_access",
      error,
    });
    return getStaticFreePlanModelAccess();
  }
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
    console.error("BranchMind user free plan initialization failed", {
      userId,
      table: "branchmind_user_plans",
      error,
    });
  }
}

function defaultPlanInfo(plan = DEFAULT_ACCOUNT_PLAN): SupabaseAccountPlanInfo {
  return {
    plan,
    displayName: null,
    languagePreference: DEFAULT_LANGUAGE,
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
    .select("plan, display_name, language_preference, subscription_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (planError) {
    console.error("BranchMind user plan lookup failed", {
      userId,
      table: "branchmind_user_plans",
      error: planError,
    });
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
    console.error("BranchMind plan limits lookup failed", {
      userId,
      table: "branchmind_plan_limits",
      error: limitsError,
    });
  }

  return {
    plan,
    displayName: planRow.display_name ?? null,
    languagePreference: getBranchMindLanguage(planRow.language_preference),
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
