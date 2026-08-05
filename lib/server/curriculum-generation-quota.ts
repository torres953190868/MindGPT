// Monthly curriculum generation quota (spec §11.6).
//
// Curriculum generation is the most expensive operation in the dual-agent
// system; quotas are enforced at the API layer before the runner starts. The
// limits are plan-scoped and read from environment variables so operators can
// tune them without a deploy. Local-mode users are never tracked or blocked.

import { AgentError } from "@/lib/agent-runtime/agent-errors";
import { countRunsByUserAndTypeSince } from "@/lib/agent-runtime/agent-run-service";
import { normalizeAccountPlan, type AccountPlan } from "@/lib/server/account-plan";

export const CURRICULUM_GENERATION_QUOTA_ERROR_CODE = "CURRICULUM_GENERATION_QUOTA_EXCEEDED";

function parseQuota(value: string | undefined, fallback: number | null): number | null {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function getPlanQuota(plan: AccountPlan): number | null {
  const defaults: Record<AccountPlan, number | null> = {
    free: 3,
    pro: 30,
    max: null,
  };
  const envMap: Record<AccountPlan, string | undefined> = {
    free: process.env.FREE_PLAN_MONTHLY_CURRICULUM_GENERATIONS,
    pro: process.env.PRO_PLAN_MONTHLY_CURRICULUM_GENERATIONS,
    max: process.env.MAX_PLAN_MONTHLY_CURRICULUM_GENERATIONS,
  };
  return parseQuota(envMap[plan], defaults[plan]);
}

function monthStartUtc(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`;
}

function nextMonthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export type MonthlyCurriculumGenerationQuota = {
  plan: AccountPlan | null;
  used: number;
  limit: number | null;
  remaining: number | null;
  tracked: boolean;
  resetsAt: string | null;
};

export async function getMonthlyCurriculumGenerationQuota(principal: {
  id: string;
  authMode: "supabase" | "local";
  plan?: string | null;
}): Promise<MonthlyCurriculumGenerationQuota> {
  if (principal.authMode !== "supabase") {
    return {
      plan: null,
      used: 0,
      limit: null,
      remaining: null,
      tracked: false,
      resetsAt: null,
    };
  }

  const plan = normalizeAccountPlan(principal.plan);
  const limit = getPlanQuota(plan);
  try {
    const used = await countRunsByUserAndTypeSince(
      principal.id,
      "curriculum_builder",
      monthStartUtc(),
    );
    return {
      plan,
      used,
      limit,
      remaining: limit === null ? null : Math.max(limit - used, 0),
      tracked: true,
      resetsAt: nextMonthStartUtc(),
    };
  } catch {
    // The generation route already fails open when usage storage is
    // unavailable; the informational endpoint follows the same behavior.
    return {
      plan,
      used: 0,
      limit,
      remaining: limit,
      tracked: false,
      resetsAt: nextMonthStartUtc(),
    };
  }
}

// Checks whether the user has exhausted their monthly curriculum generation
// quota. Fails open when counting is unavailable (no Supabase config or
// repository error) so local development is unaffected.
export async function assertMonthlyCurriculumGenerationQuota(principal: {
  id: string;
  authMode: "supabase" | "local";
  plan?: string | null;
}): Promise<void> {
  const quota = await getMonthlyCurriculumGenerationQuota(principal);
  if (!quota.tracked || quota.limit === null) return;

  if (quota.remaining === 0) {
    throw new AgentError(
      `You have reached your monthly curriculum generation limit (${quota.limit}). Your quota resets on the first of next month.`,
      {
        code: CURRICULUM_GENERATION_QUOTA_ERROR_CODE,
        expose: true,
        retryable: false,
        status: 429,
        details: { plan: quota.plan, limit: quota.limit, used: quota.used },
      },
    );
  }
}
