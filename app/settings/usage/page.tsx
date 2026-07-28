"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Loader2, MessageSquare, FileText, Network } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";
import type { AccountUsageDto } from "@/app/api/account/usage/route";
import { useLanguage } from "@/components/language/LanguageProvider";

type UsageTone = {
  icon: string;
  bar: string;
};

function UsageCard({
  icon: Icon,
  label,
  used,
  limit,
  tone,
  usedLabel,
  limitReachedLabel,
}: {
  icon: typeof FolderOpen;
  label: string;
  used: number;
  limit: number | null;
  tone: UsageTone;
  usedLabel: (percentage: number) => string;
  limitReachedLabel: string;
}) {
  const hasLimit = limit !== null;
  const ratio = hasLimit && limit > 0 ? used / limit : 0;
  const percentage = Math.min(Math.round(ratio * 100), 100);
  const isNearLimit = hasLimit && percentage >= 80;
  const barColor = percentage >= 95 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : tone.bar;

  return (
    <div className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone.icon}`}>
          <Icon size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-700">{label}</p>
          <p className="text-lg font-extrabold text-neutral-900">
            {used}
            {hasLimit && <span className="text-sm font-semibold text-neutral-500"> / {limit}</span>}
          </p>
        </div>
      </div>
      {hasLimit && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
          </div>
          <div className="mt-1 flex justify-between">
            <span className={`text-[11px] font-semibold ${isNearLimit ? "text-amber-600" : "text-neutral-500"}`}>
              {usedLabel(percentage)}
            </span>
            {percentage >= 95 && <span className="text-[11px] font-bold text-red-500">{limitReachedLabel}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsageSettingsPage() {
  const { copy } = useLanguage();
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [history, setHistory] = useState<AccountUsageDto["history"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [accountRes, historyRes] = await Promise.all([
          fetch("/api/account"),
          fetch("/api/account/usage"),
        ]);
        const accountData = (await accountRes.json().catch(() => null)) as AccountDto | null;
        const historyData = (await historyRes.json().catch(() => null)) as AccountUsageDto | null;
        if (accountRes.ok) setAccount(accountData);
        if (historyRes.ok) setHistory(historyData?.history ?? []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-neutral-600" />
      </div>
    );
  }

  const usage = account?.usage;
  const usageTones = {
    projects: {
      icon: "bg-brand-50 text-brand-800 ring-1 ring-brand-100",
      bar: "bg-brand-600",
    },
    nodes: {
      icon: "bg-success-50 text-success-700 ring-1 ring-success-100",
      bar: "bg-success-600",
    },
    documents: {
      icon: "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200",
      bar: "bg-neutral-600",
    },
    messages: {
      icon: "bg-danger-50 text-danger-600 ring-1 ring-danger-100",
      bar: "bg-danger-600",
    },
  };

  return (
    <div className="space-y-5">
      {/* Usage Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {usage && (
          <>
            <UsageCard icon={FolderOpen} label={copy.usage.projects} used={usage.projects.used} limit={usage.projects.limit} tone={usageTones.projects} usedLabel={copy.usage.used} limitReachedLabel={copy.usage.limitReached} />
            <UsageCard icon={Network} label={copy.usage.nodes} used={usage.nodes.used} limit={usage.nodes.limit} tone={usageTones.nodes} usedLabel={copy.usage.used} limitReachedLabel={copy.usage.limitReached} />
            <UsageCard icon={FileText} label={copy.usage.documents} used={usage.documents.used} limit={usage.documents.limit} tone={usageTones.documents} usedLabel={copy.usage.used} limitReachedLabel={copy.usage.limitReached} />
            <UsageCard icon={MessageSquare} label={copy.usage.aiMessages} used={usage.aiMessages.used} limit={usage.aiMessages.limit} tone={usageTones.messages} usedLabel={copy.usage.used} limitReachedLabel={copy.usage.limitReached} />
          </>
        )}
      </div>

      {/* History Table */}
      <div className="rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-md">
        <h2 className="text-base font-extrabold text-neutral-900">{copy.settings.usageHistory}</h2>
        <p className="mt-0.5 text-sm font-semibold text-neutral-600">{copy.settings.usageHistoryDescription}</p>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg bg-surface-muted py-8 text-center">
            <p className="text-sm font-semibold text-neutral-500">{copy.settings.usageNoHistory}</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="py-2 pr-4 text-left font-semibold text-neutral-700">{copy.usage.date}</th>
                  <th className="py-2 pr-4 text-right font-semibold text-neutral-700">{copy.usage.projects}</th>
                  <th className="py-2 pr-4 text-right font-semibold text-neutral-700">{copy.usage.nodes}</th>
                  <th className="py-2 pr-4 text-right font-semibold text-neutral-700">{copy.usage.pdfs}</th>
                  <th className="py-2 text-right font-semibold text-neutral-700">{copy.usage.aiMsgs}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.date} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-neutral-900">{row.date}</td>
                    <td className="py-2.5 pr-4 text-right text-neutral-700">{row.projectCount}</td>
                    <td className="py-2.5 pr-4 text-right text-neutral-700">{row.nodeCount}</td>
                    <td className="py-2.5 pr-4 text-right text-neutral-700">{row.documentCount}</td>
                    <td className="py-2.5 text-right text-neutral-700">{row.aiMessageCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
