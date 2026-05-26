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
    iconColor: "bg-[#fff4d6] text-[#8a6a20] ring-1 ring-[#ead8a7]",
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
    iconColor: "bg-[#ebe4f8] text-[#5a3d88] ring-1 ring-[#d8caef]",
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
    key: "max",
    name: "Max",
    price: "$29",
    period: "/month",
    description: "Unlock every workspace limit.",
    icon: Crown,
    iconColor: "bg-[#deebe4] text-[#315d4f] ring-1 ring-[#c8ded4]",
    eyebrow: "Maximum room",
    features: [
      { label: "Unlimited everything" },
      { label: "Shared workspaces" },
      { label: "Unlimited knowledge base" },
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
        <Loader2 size={24} className="animate-spin text-[#766d78]" />
      </div>
    );
  }

  const currentPlan = account?.plan ?? "free";
  const currentPlanMeta = PLANS.find((plan) => plan.key === currentPlan) ?? PLANS[0];
  const CurrentPlanIcon = currentPlanMeta.icon;
  const isFreePlan = currentPlan === "free";
  const isActiveSubscription = account?.subscriptionStatus === "active";

  return (
    <div className="space-y-5 text-[#29252f]">
      <div className="overflow-hidden rounded-lg border border-[#ddd4c7] bg-[#fffdf8] shadow-[0_18px_42px_rgba(52,45,35,0.055)]">
        <div className="flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-stretch lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${currentPlanMeta.iconColor}`}>
                <CurrentPlanIcon size={18} />
              </span>
              <span className="text-xs font-black uppercase tracking-[0.14em] text-[#766d78]">
                Current plan
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  isActiveSubscription ? "bg-[#deebe4] text-[#315d4f]" : "bg-[#f4efe7] text-[#5e5661]"
                }`}
              >
                {isActiveSubscription ? "Active subscription" : "No billing required"}
              </span>
            </div>

            <h2 className="mt-4 text-2xl font-black capitalize tracking-normal text-[#29252f]">
              {currentPlan} Plan
            </h2>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-[#766d78]">
              {isFreePlan
                ? "Free is good for trying BranchMind. Pro removes the project and node ceilings when your workspace starts to grow."
                : "Your workspace is already on an upgraded plan with more room for documents, ideas, and AI work."}
            </p>

            {isFreePlan && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {FREE_LIMITS.map((limit) => (
                  <div key={limit.label} className="rounded-lg border border-[#ddd4c7] bg-[#f6f1e9] px-3 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#766d78]">{limit.label}</p>
                    <p className="mt-0.5 text-sm font-black text-[#29252f]">{limit.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#ddd4c7] bg-[#f6f1e9] p-4 lg:w-72">
            <div className="flex items-center gap-2 text-sm font-black text-[#29252f]">
              <ShieldCheck size={17} className="text-[#315d4f]" />
              Upgrade path
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#766d78]">
              Pro unlocks unlimited projects and nodes, plus 10x more daily AI messages.
            </p>
            <button
              type="button"
              onClick={() => handleUpgrade("pro")}
              disabled={!isFreePlan}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#28242d] px-4 text-sm font-black text-[#fffdf8] shadow-[0_12px_24px_rgba(40,36,45,0.18)] transition hover:-translate-y-0.5 hover:bg-[#1e1a24] disabled:cursor-default disabled:bg-[#d8d0c5] disabled:text-[#8a8178] disabled:shadow-none disabled:hover:translate-y-0"
            >
              {isFreePlan ? "Upgrade to Pro" : "Plan active"}
              {isFreePlan && <ArrowRight size={16} />}
            </button>
            <p className="mt-2 text-xs font-semibold text-[#8d838d]">Checkout integration is coming in Phase 2.</p>
          </div>
        </div>
      </div>

      {upgradeMessage && (
        <div className="rounded-lg border border-[#e7c777] bg-[#fff4d6] px-4 py-3 text-sm font-bold text-[#8a6a20] shadow-sm">
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
              className={`relative flex min-h-[350px] flex-col rounded-lg border p-5 transition ${
                plan.popular
                  ? "border-[#28242d] bg-[#fffdf8] shadow-[0_20px_46px_rgba(40,36,45,0.12)] ring-1 ring-[#28242d]/10 md:-translate-y-1"
                  : "border-[#ddd4c7] bg-[#fffdf8] shadow-[0_14px_34px_rgba(52,45,35,0.045)]"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#28242d] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#fffdf8] shadow-lg shadow-[#28242d]/15">
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
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#766d78]">
                      {plan.eyebrow}
                    </p>
                    <h3 className="mt-0.5 text-base font-black text-[#29252f]">{plan.name}</h3>
                  </div>
                </div>
                {isCurrent && (
                  <span className="rounded-full bg-[#deebe4] px-2.5 py-1 text-[11px] font-extrabold text-[#315d4f]">
                    Current
                  </span>
                )}
              </div>

              <p className="mt-4 min-h-10 text-sm font-semibold leading-5 text-[#766d78]">{plan.description}</p>

              <div className="mt-5">
                <span className={`${plan.popular ? "text-4xl" : "text-3xl"} font-black text-[#29252f]`}>
                  {plan.price}
                </span>
                <span className="text-sm font-bold text-[#8d838d]">{plan.period}</span>
              </div>

              <ul className="mt-5 space-y-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature.label}
                    className={`flex items-start gap-2 text-sm ${
                      "highlight" in feature && feature.highlight
                        ? "font-black text-[#29252f]"
                        : "font-semibold text-[#5e5661]"
                    }`}
                  >
                    <Check size={15} className="mt-0.5 shrink-0 text-[#315d4f]" />
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
                      ? "cursor-default bg-[#f4efe7] text-[#8d838d]"
                      : plan.popular && !plan.ctaDisabled
                        ? "bg-[#28242d] text-[#fffdf8] shadow-[0_12px_24px_rgba(40,36,45,0.18)] hover:-translate-y-0.5 hover:bg-[#1e1a24]"
                        : "border border-[#d9d0c2] bg-[#fffdf8] text-[#5e5661] hover:border-[#c7bcad] hover:bg-[#fffaf3]"
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

      <div className="rounded-lg border border-[#ddd4c7] bg-[#fffdf8] p-5 shadow-[0_18px_42px_rgba(52,45,35,0.055)]">
        <h2 className="text-base font-black text-[#29252f]">Invoices</h2>
        <p className="mt-0.5 text-sm font-semibold text-[#766d78]">Your billing history will appear here.</p>
        <div className="mt-4 rounded-lg border border-dashed border-[#d9d0c2] bg-[#f6f1e9] py-8 text-center">
          <p className="text-sm font-bold text-[#8d838d]">No invoices yet.</p>
        </div>
      </div>
    </div>
  );
}
