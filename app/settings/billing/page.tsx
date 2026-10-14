"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Crown, Loader2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useAuthStore } from "@/store/useAuthStore";

const PLANS = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    period: "",
    icon: Zap,
    iconColor: "bg-warning-50 text-warning-600 ring-1 ring-warning-200",
    ctaDisabled: true,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$9",
    period: "/month",
    icon: Crown,
    iconColor: "bg-brand-50 text-brand-600 ring-1 ring-brand-200",
    ctaDisabled: false,
    popular: true,
  },
  {
    key: "max",
    name: "Max",
    price: "$29",
    period: "/month",
    icon: Crown,
    iconColor: "bg-success-100 text-success-700 ring-1 ring-success-200",
    ctaDisabled: true,
  },
];

export default function BillingSettingsPage() {
  const { copy, language } = useLanguage();
  const setAccountCache = useAuthStore((state) => state.setAccountCache);
  const [account, setAccount] = useState<AccountDto | null>(
    () => useAuthStore.getState().account,
  );
  const [loading, setLoading] = useState(
    () => useAuthStore.getState().account === null,
  );
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/account");
      const data = (await res.json().catch(() => null)) as AccountDto | null;
      if (res.ok && data) {
        setAccount(data);
        setAccountCache(data);
      }
    } finally {
      setLoading(false);
    }
  }, [setAccountCache]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  function handleUpgrade(planKey: string) {
    if (planKey === "pro") {
      setUpgradeMessage(copy.billing.stripeComing);
      setTimeout(() => setUpgradeMessage(null), 4000);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  const currentPlan = account?.plan ?? "free";
  const currentPlanMeta = PLANS.find((plan) => plan.key === currentPlan) ?? PLANS[0];
  const localizedPlans = PLANS.map((plan) => {
    if (plan.key === "free") {
      return {
        ...plan,
        description: copy.billing.freeDescription,
        eyebrow: copy.billing.starterLimits,
        features: copy.billing.freeFeatures,
        cta: copy.billing.freeTier,
      };
    }
    if (plan.key === "pro") {
      return {
        ...plan,
        period: copy.billing.perMonth,
        description: copy.billing.proDescription,
        eyebrow: copy.billing.proEyebrow,
        features: copy.billing.proFeatures,
        cta: copy.billing.upgradeToPro,
      };
    }
    return {
      ...plan,
      period: copy.billing.perMonth,
      description: copy.billing.maxDescription,
      eyebrow: copy.billing.maxEyebrow,
      features: copy.billing.maxFeatures,
      cta: copy.billing.comingSoon,
    };
  });
  const freeLimits = [
    { label: copy.usage.projects, value: language === "zh" ? "最多 5" : "5 max" },
    { label: copy.usage.nodes, value: language === "zh" ? "最多 100" : "100 max" },
    { label: copy.usage.pdfs, value: language === "zh" ? "最多 3" : "3 max" },
  ];
  const CurrentPlanIcon = currentPlanMeta.icon;
  const isFreePlan = currentPlan === "free";
  const isActiveSubscription = account?.subscriptionStatus === "active";

  return (
    <div className="space-y-5 text-neutral-900">
      <div className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-[0_18px_42px_rgba(52,45,35,0.055)]">
        <div className="flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-stretch lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${currentPlanMeta.iconColor}`}>
                <CurrentPlanIcon size={18} />
              </span>
              <span className="text-xs font-black uppercase tracking-[0.14em] text-text-muted">
                {copy.billing.currentPlan}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  isActiveSubscription ? "bg-success-100 text-success-700" : "bg-surface-muted text-text-secondary"
                }`}
              >
                {isActiveSubscription ? copy.billing.activeSubscription : copy.billing.noBillingRequired}
              </span>
            </div>

            <h2 className="mt-4 text-2xl font-black capitalize tracking-normal text-neutral-900">
              {copy.billing.currentPlanTitle(currentPlanMeta.name)}
            </h2>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-text-muted">
              {isFreePlan
                ? copy.billing.freePlanBody
                : copy.billing.upgradedBody}
            </p>

            {isFreePlan && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {freeLimits.map((limit) => (
                  <div key={limit.label} className="rounded-lg border border-border-default bg-surface-muted px-3 py-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{limit.label}</p>
                    <p className="mt-0.5 text-sm font-black text-neutral-900">{limit.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-default bg-surface-muted p-4 lg:w-72">
            <div className="flex items-center gap-2 text-sm font-black text-neutral-900">
              <ShieldCheck size={17} className="text-success-700" />
              {copy.billing.upgradePath}
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-text-muted">
              {copy.billing.proBody}
            </p>
            <button
              type="button"
              onClick={() => handleUpgrade("pro")}
              disabled={!isFreePlan}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-black text-white shadow-[0_12px_24px_rgba(60,45,30,0.18)] transition hover:-translate-y-0.5 hover:bg-brand-800 disabled:cursor-default disabled:bg-neutral-300 disabled:text-text-muted disabled:shadow-none disabled:hover:translate-y-0"
            >
              {isFreePlan ? copy.billing.upgradeToPro : copy.billing.planActive}
              {isFreePlan && <ArrowRight size={16} />}
            </button>
            <p className="mt-2 text-xs font-semibold text-text-muted">{copy.billing.checkoutComing}</p>
          </div>
        </div>
      </div>

      {upgradeMessage && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm font-bold text-warning-600 shadow-sm">
          {upgradeMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {localizedPlans.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          const Icon = plan.icon;
          return (
            <div
              key={plan.key}
              className={`relative flex min-h-[350px] flex-col rounded-lg border p-5 transition ${
                plan.popular
                  ? "border-neutral-900 bg-surface-elevated shadow-[0_20px_46px_rgba(60,45,30,0.12)] ring-1 ring-neutral-900/10 md:-translate-y-1"
                  : "border-border-default bg-surface-elevated shadow-[0_14px_34px_rgba(52,45,35,0.045)]"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-brand-900 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-lg shadow-neutral-900/15">
                  <Sparkles size={11} />
                  {copy.billing.recommended}
                </span>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${plan.iconColor}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">
                      {plan.eyebrow}
                    </p>
                    <h3 className="mt-0.5 text-base font-black text-neutral-900">{plan.name}</h3>
                  </div>
                </div>
                {isCurrent && (
                  <span className="rounded-full bg-success-100 px-2.5 py-1 text-[11px] font-extrabold text-success-700">
                    {copy.billing.current}
                  </span>
                )}
              </div>

              <p className="mt-4 min-h-10 text-sm font-semibold leading-5 text-text-muted">{plan.description}</p>

              <div className="mt-5">
                <span className={`${plan.popular ? "text-4xl" : "text-3xl"} font-black text-neutral-900`}>
                  {plan.price}
                </span>
                <span className="text-sm font-bold text-text-muted">{plan.period}</span>
              </div>

              <ul className="mt-5 space-y-3">
                {plan.features.map((feature) => (
                  <li
                    key={feature.label}
                    className={`flex items-start gap-2 text-sm ${
                      "highlight" in feature && feature.highlight
                        ? "font-black text-neutral-900"
                        : "font-semibold text-text-secondary"
                    }`}
                  >
                    <Check size={15} className="mt-0.5 shrink-0 text-success-700" />
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
                      ? "cursor-default bg-surface-muted text-text-muted"
                      : plan.popular && !plan.ctaDisabled
                        ? "bg-brand-900 text-white shadow-[0_12px_24px_rgba(60,45,30,0.18)] hover:-translate-y-0.5 hover:bg-brand-800"
                        : "border border-border-default bg-surface-elevated text-text-secondary hover:border-border-default hover:bg-surface-elevated"
                  } disabled:opacity-75`}
                >
                  {isCurrent ? copy.billing.currentPlanCta : plan.cta}
                  {!isCurrent && plan.popular && !plan.ctaDisabled && <ArrowRight size={16} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border-default bg-surface-elevated p-5 shadow-[0_18px_42px_rgba(52,45,35,0.055)]">
        <h2 className="text-base font-black text-neutral-900">{copy.billing.invoices}</h2>
        <p className="mt-0.5 text-sm font-semibold text-text-muted">{copy.billing.invoicesDescription}</p>
        <div className="mt-4 rounded-lg border border-dashed border-border-default bg-surface-muted py-8 text-center">
          <p className="text-sm font-bold text-text-muted">{copy.billing.noInvoices}</p>
        </div>
      </div>
    </div>
  );
}
