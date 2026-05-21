"use client";

import { useEffect, useState } from "react";
import { Check, Crown, Loader2, Zap } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Perfect for getting started.",
    icon: Zap,
    iconColor: "text-amber-600 bg-amber-100",
    features: ["5 projects", "100 nodes", "3 PDF documents", "50 AI messages/day", "Community support"],
    cta: "Current plan",
    ctaDisabled: true,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$9",
    period: "/month",
    description: "For power users who need more.",
    icon: Crown,
    iconColor: "text-purple-600 bg-purple-100",
    features: ["Unlimited projects", "Unlimited nodes", "50 PDF documents", "500 AI messages/day", "Priority support"],
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
    iconColor: "text-blue-600 bg-blue-100",
    features: ["Unlimited everything", "Shared workspaces", "Team knowledge base", "Unlimited AI messages", "Dedicated support"],
    cta: "Coming soon",
    ctaDisabled: true,
  },
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

  return (
    <div className="space-y-5">
      {/* Current Plan */}
      <div className="rounded-xl border border-[#f0ebf5] bg-white p-5 shadow-sm">
        <h2 className="text-base font-extrabold text-[#342b3a]">Current Plan</h2>
        <div className="mt-4 flex items-center gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg ${currentPlan === "pro" ? "bg-purple-100 text-purple-600" : currentPlan === "team" ? "bg-blue-100 text-blue-600" : "bg-amber-100 text-amber-600"}`}>
            {currentPlan === "free" ? <Zap size={22} /> : <Crown size={22} />}
          </span>
          <div>
            <p className="text-lg font-extrabold capitalize text-[#342b3a]">{currentPlan} Plan</p>
            <p className="text-sm text-[#9b8fa8]">
              {account?.subscriptionStatus === "active"
                ? "Active subscription"
                : "Free tier — no billing required"}
            </p>
          </div>
        </div>
      </div>

      {/* Upgrade Message */}
      {upgradeMessage && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm font-bold text-purple-700">
          {upgradeMessage}
        </div>
      )}

      {/* Plan Comparison */}
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          const Icon = plan.icon;
          return (
            <div
              key={plan.key}
              className={`relative flex flex-col rounded-xl border p-5 shadow-sm ${
                plan.popular
                  ? "border-purple-200 bg-purple-50/50"
                  : "border-[#f0ebf5] bg-white"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-600 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                  Popular
                </span>
              )}
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${plan.iconColor}`}>
                  <Icon size={18} />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-[#342b3a]">{plan.name}</h3>
                  <p className="text-xs text-[#9b8fa8]">{plan.description}</p>
                </div>
              </div>

              <div className="mt-4">
                <span className="text-2xl font-extrabold text-[#342b3a]">{plan.price}</span>
                <span className="text-sm font-medium text-[#9b8fa8]">{plan.period}</span>
              </div>

              <ul className="mt-4 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-[#554665]">
                    <Check size={14} className="mt-0.5 shrink-0 text-green-600" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-5">
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan.key)}
                  disabled={plan.ctaDisabled || isCurrent}
                  className={`inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-extrabold transition ${
                    isCurrent
                      ? "cursor-default bg-neutral-100 text-neutral-500"
                      : plan.popular && !plan.ctaDisabled
                        ? "bg-purple-600 text-white shadow-sm hover:bg-purple-700"
                        : "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                  } disabled:opacity-60`}
                >
                  {isCurrent ? "Current plan" : plan.cta}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Invoices */}
      <div className="rounded-xl border border-[#f0ebf5] bg-white p-5 shadow-sm">
        <h2 className="text-base font-extrabold text-[#342b3a]">Invoices</h2>
        <p className="mt-0.5 text-sm text-[#9b8fa8]">Your billing history will appear here.</p>
        <div className="mt-4 rounded-lg bg-[#f9f6fc] py-8 text-center">
          <p className="text-sm font-medium text-[#9b8fa8]">No invoices yet.</p>
        </div>
      </div>
    </div>
  );
}
