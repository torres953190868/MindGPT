"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Loader2, MessageSquare, FileText, Network } from "lucide-react";
import type { AccountDto } from "@/app/api/account/route";
import type { AccountUsageDto } from "@/app/api/account/usage/route";

function UsageCard({
  icon: Icon,
  label,
  used,
  limit,
  color,
}: {
  icon: typeof FolderOpen;
  label: string;
  used: number;
  limit: number | null;
  color: string;
}) {
  const hasLimit = limit !== null;
  const ratio = hasLimit && limit > 0 ? used / limit : 0;
  const percentage = Math.min(Math.round(ratio * 100), 100);
  const isNearLimit = hasLimit && percentage >= 80;
  const barColor = percentage >= 95 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : color;

  return (
    <div className="rounded-xl border border-[#f0ebf5] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${color.replace("bg-", "bg-").replace("500", "100")} ${color.replace("bg-", "text-")}`}>
          <Icon size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-[#554665]">{label}</p>
          <p className="text-lg font-extrabold text-[#342b3a]">
            {used}
            {hasLimit && <span className="text-sm font-semibold text-[#9b8fa8]"> / {limit}</span>}
          </p>
        </div>
      </div>
      {hasLimit && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-[#f0ebf5]">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
          </div>
          <div className="mt-1 flex justify-between">
            <span className={`text-[11px] font-semibold ${isNearLimit ? "text-amber-600" : "text-[#9b8fa8]"}`}>
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
        <Loader2 size={24} className="animate-spin text-[#9b8fa8]" />
      </div>
    );
  }

  const usage = account?.usage;

  return (
    <div className="space-y-5">
      {/* Usage Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {usage && (
          <>
            <UsageCard icon={FolderOpen} label="Projects" used={usage.projects.used} limit={usage.projects.limit} color="bg-purple-500" />
            <UsageCard icon={Network} label="Nodes" used={usage.nodes.used} limit={usage.nodes.limit} color="bg-emerald-500" />
            <UsageCard icon={FileText} label="PDF Documents" used={usage.documents.used} limit={usage.documents.limit} color="bg-blue-500" />
            <UsageCard icon={MessageSquare} label="AI Messages (today)" used={usage.aiMessages.used} limit={usage.aiMessages.limit} color="bg-rose-500" />
          </>
        )}
      </div>

      {/* History Table */}
      <div className="rounded-xl border border-[#f0ebf5] bg-white p-5 shadow-sm">
        <h2 className="text-base font-extrabold text-[#342b3a]">Daily Usage History</h2>
        <p className="mt-0.5 text-sm text-[#9b8fa8]">Last 30 days of resource usage.</p>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg bg-[#f9f6fc] py-8 text-center">
            <p className="text-sm font-medium text-[#9b8fa8]">No usage history available yet.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0ebf5]">
                  <th className="py-2 pr-4 text-left font-semibold text-[#554665]">Date</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#554665]">Projects</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#554665]">Nodes</th>
                  <th className="py-2 pr-4 text-right font-semibold text-[#554665]">PDFs</th>
                  <th className="py-2 text-right font-semibold text-[#554665]">AI Msgs</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.date} className="border-b border-[#f9f6fc] last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-[#342b3a]">{row.date}</td>
                    <td className="py-2.5 pr-4 text-right text-[#554665]">{row.projectCount}</td>
                    <td className="py-2.5 pr-4 text-right text-[#554665]">{row.nodeCount}</td>
                    <td className="py-2.5 pr-4 text-right text-[#554665]">{row.documentCount}</td>
                    <td className="py-2.5 text-right text-[#554665]">{row.aiMessageCount}</td>
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
