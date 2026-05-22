import Link from "next/link";
import { AlertCircle, ArrowRight, Bug, CheckCircle2, Route, Server } from "lucide-react";
import { getBugReportCounts } from "@/lib/server/bug-reports";
import { getAdminLlmConfig } from "@/lib/server/llm-router";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const cardClassName =
  "rounded-lg border border-[#e4ddd4] bg-[#fffdf9] p-5 shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const secondaryButtonClassName =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#ddd5cb] bg-[#fffdf9] px-3 text-sm font-bold text-[#4f4650] shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-[#cfc5b8] hover:bg-white focus:outline-none focus:ring-4 focus:ring-[#d9cdbd]/35";

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#e4ddd4] bg-[#fffdf9] p-4 shadow-[0_14px_34px_rgba(35,31,26,0.05)]">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#8c828f]">{label}</p>
      <p className="mt-2 text-3xl font-black text-[#25222b]">{value}</p>
      <p className="mt-1 text-sm font-semibold text-[#7b717f]">{detail}</p>
    </div>
  );
}

export default async function AdminIndexPage() {
  const config = await getAdminLlmConfig();
  const bugReports = hasSupabaseServerConfig()
    ? await getBugReportCounts().catch(() => ({ open: 0, total: 0 }))
    : { open: 0, total: 0 };
  const configuredProviders = config.providers.filter(
    (provider) => Boolean(process.env[provider.apiKeyEnv]?.trim()),
  );

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Providers"
          value={`${config.providers.filter((provider) => provider.enabled).length}/${config.providers.length}`}
          detail={`${configuredProviders.length} with API keys`}
        />
        <StatCard
          label="Models"
          value={`${config.models.filter((model) => model.enabled).length}/${config.models.length}`}
          detail="Enabled models across providers"
        />
        <StatCard
          label="Routes"
          value={config.routes.length}
          detail="Task defaults and fallbacks"
        />
        <StatCard
          label="Open bugs"
          value={bugReports.open}
          detail={`${bugReports.total} total reports`}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className={cardClassName}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Route size={18} className="text-[#3b7d8b]" />
              <h2 className="text-base font-black text-[#25222b]">Default Routes</h2>
            </div>
            <Link
              href="/admin/models"
              className={secondaryButtonClassName}
            >
              Manage
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e4ddd4] text-left text-xs uppercase tracking-[0.12em] text-[#8c828f]">
                  <th className="py-2 pr-4">Task</th>
                  <th className="py-2 pr-4">Default</th>
                  <th className="py-2">Fallback</th>
                </tr>
              </thead>
              <tbody>
                {config.routes.map((route) => (
                  <tr key={route.task} className="border-b border-[#eee7df] last:border-0">
                    <td className="py-3 pr-4 font-bold text-[#4f4650]">{route.task}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-[#5c5360]">
                      {route.defaultProviderId}:{route.defaultModel}
                    </td>
                    <td className="py-3 font-mono text-xs text-[#7b717f]">
                      {route.fallbackProviderId && route.fallbackModel
                        ? `${route.fallbackProviderId}:${route.fallbackModel}`
                        : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={cardClassName}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bug size={18} className="text-[#9a6b2f]" />
              <h2 className="text-base font-black text-[#25222b]">Bug Queue</h2>
            </div>
            <Link
              href="/admin/bugs"
              className={secondaryButtonClassName}
            >
              Review
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#f0d9ad] bg-[#fff8ea] p-4">
              <AlertCircle size={18} className="text-[#9a6b2f]" />
              <p className="mt-3 text-2xl font-black text-[#25222b]">{bugReports.open}</p>
              <p className="text-sm font-semibold text-[#8a6735]">Open reports</p>
            </div>
            <div className="rounded-lg border border-[#d6e4dc] bg-[#edf3ef] p-4">
              <CheckCircle2 size={18} className="text-[#2f6651]" />
              <p className="mt-3 text-2xl font-black text-[#25222b]">
                {Math.max(bugReports.total - bugReports.open, 0)}
              </p>
              <p className="text-sm font-semibold text-[#2f6651]">Handled reports</p>
            </div>
          </div>
        </div>
      </section>

      <section className={cardClassName}>
        <div className="flex items-center gap-2">
          <Server size={18} className="text-[#6e5a94]" />
          <h2 className="text-base font-black text-[#25222b]">Provider Health</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {config.providers.map((provider) => (
            <div key={provider.providerId} className="rounded-lg border border-[#e4ddd4] bg-[#f8f5ee] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black text-[#25222b]">{provider.displayName}</p>
                  <p className="mt-0.5 font-mono text-xs text-[#8c828f]">{provider.providerId}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-black ${
                    provider.enabled
                      ? "bg-[#eaf4ef] text-[#2f6651]"
                      : "bg-[#ebe6dd] text-[#6f6670]"
                  }`}
                >
                  {provider.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-3 truncate font-mono text-xs text-[#716675]">{provider.baseUrl}</p>
              <p className="mt-2 text-xs font-bold text-[#8c828f]">
                Key env: {provider.apiKeyEnv}
                {process.env[provider.apiKeyEnv]?.trim() ? " configured" : " missing"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
