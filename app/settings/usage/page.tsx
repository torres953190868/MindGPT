"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Loader2, MessageSquare, FileText, Network } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";
import type { AccountUsageDto } from "@/app/api/account/usage/route";

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
}: {
  icon: typeof FolderOpen;
  label: string;
  used: number;
  limit: number | null;
  tone: UsageTone;
}) {
  const hasLimit = limit !== null;
  const ratio = hasLimit && limit > 0 ? used / limit : 0;
  const percentage = Math.min(Math.round(ratio * 100), 100);
  const isNearLimit = hasLimit && percentage >= 80;
  const barColor = percentage >= 95 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : tone.bar;

  return (
    <div className="rounded-lg border border-[#ddd4c7] bg-[#fffdf8] p-5 shadow-[0_14px_34px_rgba(52,45,35,0.05)]">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone.icon}`}>
          <Icon size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-[#5e5661]">{label}</p>
          <p className="text-lg font-extrabold text-[#29252f]">
            {used}
            {hasLimit && <span className="text-sm font-semibold text-[#8d838d]"> / {limit}</span>}
          </p>
        </div>
      </div>
      {hasLimit && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-[#ede6db]">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
          </div>
          <div className="mt-1 flex justify-between">
            <span className={`text-[11px] font-semibold ${isNearLimit ? "text-amber-600" : "text-[#8d838d]"}`}>
              {percentage}% used
            </span>
            {percentage >= 95 && <span className="text-[11px] font-bold text-red-500">Limit reached</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsageSettingsPage() {
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
        <Loader2 size={24} className="animate-spin text-[#766d78]" />
      </div>
    );
  }

  const usage = account?.usage;
  const usageTones = {
    projects: {
      icon: "bg-[#ebe4f8] text-[#5a3d88] ring-1 ring-[#d8caef]",
      bar: "bg-[#6e4ca0]",
    },
    nodes: {
      icon: "bg-[#deebe4] text-[#315d4f] ring-1 ring-[#c8ded4]",
      bar: "bg-[#315d4f]",
    },
    documents: {
      icon: "bg-[#e8edf2] text-[#48637a] ring-1 ring-[#d1dae2]",
      bar: "bg-[#48637a]",
    },
    messages: {
      icon: "bg-[#f4e2df] text-[#8f3f3a] ring-1 ring-[#e8c9c4]",
      bar: "bg-[#8f3f3a]",
    },
  };

  return (
    <div className="space-y-5">
      {/* Usage Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {usage && (
          <>
            <UsageCard icon={FolderOpen} label="Projects" used={usage.projects.used} limit={usage.projects.limit} tone={usageTones.projects} />
            <UsageCard icon={Network} label="Nodes" used={usage.nodes.used} limit={usage.nodes.limit} tone={usageTones.nodes} />
            <UsageCard icon={FileText} label="PDF Documents" used={usage.documents.used} limit={usage.documents.limit} tone={usageTones.documents} />
            <UsageCard icon={MessageSquare} label="AI Messages (today)" used={usage.aiMessages.used} limit={usage.aiMessages.limit} tone={usageTones.messages} />
          </>
        )}
      </div>

      {/* History Table */}
      <div className="rounded-lg border border-[#ddd4c7] bg-[#fffdf8] p-5 shadow-[0_18px_42px_rgba(52,45,35,0.055)]">
        <h2 className="text-base font-extrabold text-[#29252f]">Daily Usage History</h2>
        <p className="mt-0.5 text-sm font-semibold text-[#766d78]">Last 30 days of resource usage.</p>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg bg-[#f6f1e9] py-8 text-center">
            <p className="text-sm font-semibold text-[#8d838d]">No usage history available yet.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#ddd4c7]">
                  <th className="py-2 pr-4 text-left font-semibold text-[#5e5661]">Date</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#5e5661]">Projects</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#5e5661]">Nodes</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#5e5661]">PDFs</th>
                  <th className="py-2 text-right font-semibold text-[#5e5661]">AI Msgs</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.date} className="border-b border-[#eee7de] last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-[#29252f]">{row.date}</td>
                    <td className="py-2.5 pr-4 text-right text-[#5e5661]">{row.projectCount}</td>
                    <td className="py-2.5 pr-4 text-right text-[#5e5661]">{row.nodeCount}</td>
                    <td className="py-2.5 pr-4 text-right text-[#5e5661]">{row.documentCount}</td>
                    <td className="py-2.5 text-right text-[#5e5661]">{row.aiMessageCount}</td>
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
