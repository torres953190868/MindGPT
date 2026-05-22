"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Crown, Loader2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "A focused starter tier with clear usage limits.",
    icon: Zap,
    iconColor: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    eyebrow: "Starter limits",
    features: [
      { label: "5 projects" },
      { label: "100 nodes" },
      { label: "3 PDF documents" },
      { label: "50 AI messages/day" },
      { label: "Community support" },
    ],
    cta: "Free tier",
    ctaDisabled: true,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$9",
    period: "/month",
    description: "Remove limits and keep building.",
    icon: Crown,
    iconColor: "bg-[#f0ecff] text-[#5b37b7] ring-1 ring-[#d8cff8]",
    eyebrow: "Best upgrade",
    features: [
      { label: "Unlimited projects", highlight: true },
      { label: "Unlimited nodes", highlight: true },
      { label: "50 PDF documents" },
      { label: "500 AI messages/day" },
      { label: "Priority support" },
    ],
    cta: "Upgrade to Pro",
    ctaDisabled: false,
    popular: true,
  },
  {
    key: "team",
    name: "Team",
    price: "$29",
    period: "/month",
    description: "Collaborate with your team.",
    icon: Crown,
    iconColor: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
    eyebrow: "For teams",
    features: [
      { label: "Unlimited everything" },
      { label: "Shared workspaces" },
      { label: "Team knowledge base" },
      { label: "Unlimited AI messages" },
      { label: "Dedicated support" },
    ],
    cta: "Coming soon",
    ctaDisabled: true,
  },
];

const FREE_LIMITS = [
  { label: "Projects", value: "5 max" },
  { label: "Nodes", value: "100 max" },
  { label: "PDFs", value: "3 max" },
];

export default function BillingSettingsPage() {
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/account");
        const data = (await res.json().catch(() => null)) as AccountDto | null;
        if (res.ok) setAccount(data);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleUpgrade(planKey: string) {
    if (planKey === "pro") {
      setUpgradeMessage("Stripe integration coming in Phase 2. Stay tuned!");
      setTimeout(() => setUpgradeMessage(null), 4000);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-[#9b8fa8]" />
      </div>
    );
  }

  const currentPlan = account?.plan ?? "free";
  const currentPlanMeta = PLANS.find((plan) => plan.key === currentPlan) ?? PLANS[0];
  const CurrentPlanIcon = currentPlanMeta.icon;
  const isFreePlan = currentPlan === "free";
  const isActiveSubscription = account?.subscriptionStatus === "active";

  return (
    <div className="space-y-5 text-[#1f2937]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_38px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-stretch lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${currentPlanMeta.iconColor}`}>
                <CurrentPlanIcon size={18} />
              </span>
              <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                Current plan
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  isActiveSubscription ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                }`}
              >
                {isActiveSubscription ? "Active subscription" : "No billing required"}
              </span>
            </div>

            <h2 className="mt-4 text-2xl font-black capitalize tracking-normal text-[#111827]">
              {currentPlan} Plan
            </h2>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              {isFreePlan
                ? "Free is good for trying BranchMind. Pro removes the project and node ceilings when your workspace starts to grow."
                : "Your workspace is already on an upgraded plan with more room for documents, ideas, and AI work."}
            </p>

            {isFreePlan && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {FREE_LIMITS.map((limit) => (
                  <div key={limit.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{limit.label}</p>
                    <p className="mt-0.5 text-sm font-black text-[#111827]">{limit.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:w-72">
            <div className="flex items-center gap-2 text-sm font-black text-[#111827]">
              <ShieldCheck size={17} className="text-emerald-600" />
              Upgrade path
            </div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
              Pro unlocks unlimited projects and nodes, plus 10x more daily AI messages.
            </p>
            <button
              type="button"
              onClick={() => handleUpgrade("pro")}
              disabled={!isFreePlan}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1f2937] px-4 text-sm font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.24)] transition hover:-translate-y-0.5 hover:bg-[#111827] disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0"
            >
              {isFreePlan ? "Upgrade to Pro" : "Plan active"}
              {isFreePlan && <ArrowRight size={16} />}
            </button>
            <p className="mt-2 text-xs font-semibold text-slate-500">Checkout integration is coming in Phase 2.</p>
          </div>
        </div>
      </div>

      {upgradeMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 shadow-sm">
          {upgradeMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          const Icon = plan.icon;
          return (
            <div
              key={plan.key}
              className={`relative flex min-h-[350px] flex-col rounded-xl border p-5 transition ${
                plan.popular
                  ? "border-[#1f2937] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.14)] ring-1 ring-[#1f2937]/10 md:-translate-y-1"
                  : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#1f2937] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-slate-900/20">
                  <Sparkles size={11} />
                  Recommended
                </span>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${plan.iconColor}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                      {plan.eyebrow}
                    </p>
                    <h3 className="mt-0.5 text-base font-black text-[#111827]">{plan.name}</h3>
                  </div>
                </div>
                {isCurrent && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">
                    Current
                  </span>
                )}
              </div>

              <p className="mt-4 min-h-10 text-sm font-semibold leading-5 text-slate-600">{plan.description}</p>

              <div className="mt-5">
                <span className={`${plan.popular ? "text-4xl" : "text-3xl"} font-black text-[#111827]`}>
                  {plan.price}
                </span>
                <span className="text-sm font-bold text-slate-500">{plan.period}</span>
              </div>

              <ul className="mt-5 space-y-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature.label}
                    className={`flex items-start gap-2 text-sm ${
                      "highlight" in feature && feature.highlight
                        ? "font-black text-[#111827]"
                        : "font-semibold text-slate-700"
                    }`}
                  >
                    <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                    {feature.label}
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-6">
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan.key)}
                  disabled={plan.ctaDisabled || isCurrent}
                  className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-black transition ${
                    isCurrent
                      ? "cursor-default bg-slate-100 text-slate-500"
                      : plan.popular && !plan.ctaDisabled
                        ? "bg-[#1f2937] text-white shadow-[0_12px_28px_rgba(15,23,42,0.24)] hover:-translate-y-0.5 hover:bg-[#111827]"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  } disabled:opacity-75`}
                >
                  {isCurrent ? "Current plan" : plan.cta}
                  {!isCurrent && plan.popular && !plan.ctaDisabled && <ArrowRight size={16} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-black text-[#111827]">Invoices</h2>
        <p className="mt-0.5 text-sm font-semibold text-slate-500">Your billing history will appear here.</p>
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center">
          <p className="text-sm font-bold text-slate-500">No invoices yet.</p>
        </div>
      </div>
    </div>
  );
}
