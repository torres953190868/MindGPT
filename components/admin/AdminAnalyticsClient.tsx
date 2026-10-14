"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  FileText,
  FolderKanban,
  GitBranch,
  Loader2,
  RefreshCcw,
  TrendingUp,
  Users,
} from "lucide-react";
import type {
  AdminAnalyticsBranchSplit,
  AdminAnalyticsDailyPoint,
  AdminAnalyticsDto,
} from "@/lib/types";

type AnalyticsResponse = {
  analytics: AdminAnalyticsDto;
};

type RangeDays = 7 | 30;

const RANGES: RangeDays[] = [7, 30];

const cardClassName =
  "rounded-lg border border-neutral-200 bg-surface-elevated p-5 shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const secondaryButtonClassName =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-border-default bg-surface-elevated px-3 text-sm font-bold text-text-secondary shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-border-default hover:bg-white";

async function readError(response: Response) {
  const data = await response.json().catch(() => null);
  if (data && typeof data === "object" && "error" in data) {
    const error = data.error as { message?: unknown };
    if (typeof error.message === "string") return error.message;
  }
  return `Request failed (${response.status}).`;
}

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
    <div className="rounded-lg border border-neutral-200 bg-surface-elevated p-4 shadow-[0_14px_34px_rgba(35,31,26,0.05)]">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-2 text-3xl font-black text-neutral-900">{value}</p>
      <p className="mt-1 text-sm font-semibold text-text-muted">{detail}</p>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Users;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={18} className="text-success-600" />
      <div>
        <h3 className="text-base font-black text-neutral-900">{title}</h3>
        <p className="text-xs font-semibold text-text-muted">{detail}</p>
      </div>
    </div>
  );
}

function TrendBars({
  points,
  barClassName,
}: {
  points: AdminAnalyticsDailyPoint[];
  barClassName: string;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));

  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {points.map((point) => (
          <div
            key={point.date}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${point.date}: ${point.count}`}
          >
            <div
              className={`w-full rounded-t-sm ${barClassName}`}
              style={{
                height: `${Math.max((point.count / max) * 100, point.count > 0 ? 6 : 2)}%`,
              }}
            />
          </div>
        ))}
      </div>
      {points.length > 0 && (
        <div className="mt-1.5 flex justify-between text-[10px] font-bold text-text-muted">
          <span>{points[0].date.slice(5)}</span>
          <span>{points[points.length - 1].date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}

function PlanDistributionBars({
  distribution,
}: {
  distribution: AdminAnalyticsDto["growth"]["planDistribution"];
}) {
  const entries: Array<{ plan: "free" | "pro" | "max"; count: number; className: string }> = [
    { plan: "free", count: distribution.free, className: "bg-neutral-300" },
    { plan: "pro", count: distribution.pro, className: "bg-success-600" },
    { plan: "max", count: distribution.max, className: "bg-brand-500" },
  ];
  const max = Math.max(1, ...entries.map((entry) => entry.count));

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.plan}>
          <div className="flex items-baseline justify-between text-xs font-black uppercase tracking-[0.12em]">
            <span className="text-text-secondary">{entry.plan}</span>
            <span className="text-text-muted">{entry.count}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className={`h-full rounded-full ${entry.className}`}
              style={{ width: `${(entry.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BranchSplitBar({ split }: { split: AdminAnalyticsBranchSplit }) {
  const continuePct = Math.round(split.continueShare * 100);
  const branchPct = Math.round(split.branchShare * 100);

  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-neutral-100">
        {split.continueCount > 0 && (
          <div className="h-full bg-success-600" style={{ width: `${split.continueShare * 100}%` }} />
        )}
        {split.branchCount > 0 && (
          <div className="h-full bg-brand-500" style={{ width: `${split.branchShare * 100}%` }} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-bold text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success-600" />
          Continue · {split.continueCount} ({continuePct}%)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
          Branch · {split.branchCount} ({branchPct}%)
        </span>
      </div>
    </div>
  );
}

export function AdminAnalyticsClient() {
  const [days, setDays] = useState<RangeDays>(30);
  const [analytics, setAnalytics] = useState<AdminAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async (range: RangeDays = days) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/analytics?days=${range}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as AnalyticsResponse;
      setAnalytics(data.analytics);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void loadAnalytics(days);
  }, [days, loadAnalytics]);

  return (
    <div className="space-y-5">
      <section className={`${cardClassName} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
        <div>
          <h2 className="text-base font-black text-neutral-900">Analytics</h2>
          <p className="mt-1 text-sm font-semibold text-text-muted">
            Signups, activity, and feature usage across BranchMind.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={`min-h-9 rounded-lg px-3 text-sm font-black transition ${
                days === range
                  ? "bg-brand-900 text-white shadow-[0_10px_24px_rgba(60,45,30,0.18)]"
                  : "border border-border-default bg-surface-elevated text-text-secondary hover:border-border-default hover:bg-white"
              }`}
            >
              {range} days
            </button>
          ))}
          <button
            type="button"
            onClick={() => void loadAnalytics(days)}
            className={secondaryButtonClassName}
          >
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className={`${cardClassName} grid min-h-80 place-items-center`}>
          <Loader2 size={24} className="animate-spin text-text-muted" />
        </div>
      ) : !analytics ? null : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Users" value={analytics.totals.users} detail="Total accounts" />
            <StatCard label="Projects" value={analytics.totals.projects} detail="Workspaces created" />
            <StatCard label="Nodes" value={analytics.totals.nodes} detail="Conversation nodes" />
            <StatCard label="User messages" value={analytics.totals.userMessages} detail="Messages sent by users" />
            <StatCard label="RAG documents" value={analytics.totals.documents} detail="PDFs uploaded" />
            <StatCard label="DAU" value={analytics.activity.dau} detail="Active users today" />
            <StatCard label="WAU" value={analytics.activity.wau} detail="Active users, last 7 days" />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className={cardClassName}>
              <SectionHeader
                icon={TrendingUp}
                title="Signups"
                detail={`New accounts per day, last ${analytics.rangeDays} days`}
              />
              <div className="mt-4">
                <TrendBars points={analytics.growth.signups} barClassName="bg-success-600" />
              </div>
            </div>
            <div className={cardClassName}>
              <SectionHeader
                icon={Users}
                title="Plans"
                detail="Plan and subscription distribution"
              />
              <div className="mt-4">
                <PlanDistributionBars distribution={analytics.growth.planDistribution} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
                {Object.entries(analytics.growth.subscriptionStatusCounts).map(([status, count]) => (
                  <span
                    key={status}
                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-black text-text-muted"
                  >
                    {status}: {count}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className={cardClassName}>
              <SectionHeader
                icon={Activity}
                title="Daily active users"
                detail="Distinct users with AI messages per day"
              />
              <div className="mt-4">
                <TrendBars
                  points={analytics.activity.dailyActive.map((day) => ({
                    date: day.date,
                    count: day.activeUsers,
                  }))}
                  barClassName="bg-success-600"
                />
              </div>
              <h4 className="mt-6 text-sm font-black text-neutral-900">AI messages per day</h4>
              <div className="mt-3">
                <TrendBars
                  points={analytics.activity.dailyActive.map((day) => ({
                    date: day.date,
                    count: day.messages,
                  }))}
                  barClassName="bg-warning-500"
                />
              </div>
            </div>
            <div className={cardClassName}>
              <SectionHeader
                icon={Users}
                title="Top users"
                detail={`By AI messages, last ${analytics.rangeDays} days`}
              />
              {analytics.activity.topUsers.length === 0 ? (
                <p className="mt-4 text-sm font-semibold text-text-muted">No AI activity in this range.</p>
              ) : (
                <ol className="mt-4 space-y-2">
                  {analytics.activity.topUsers.map((user, index) => (
                    <li
                      key={user.userId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-surface-muted px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-900 text-xs font-black text-white">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-bold text-neutral-900">
                          {user.accountName ?? user.userId}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-black text-text-secondary">{user.messages}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className={cardClassName}>
            <SectionHeader
              icon={GitBranch}
              title="Feature interest"
              detail="How people use branching, projects, and the PDF reader"
            />
            <div className="mt-4 grid gap-5 xl:grid-cols-2">
              <div>
                <h4 className="text-sm font-black text-neutral-900">Continue vs branch nodes</h4>
                <div className="mt-3">
                  <BranchSplitBar split={analytics.features.branchSplit} />
                </div>
              </div>
              <div className="grid gap-5">
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                    <FolderKanban size={14} className="text-success-600" />
                    Projects created per day
                  </h4>
                  <div className="mt-3">
                    <TrendBars points={analytics.features.dailyProjects} barClassName="bg-success-600" />
                  </div>
                </div>
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                    <GitBranch size={14} className="text-brand-600" />
                    Nodes created per day
                  </h4>
                  <div className="mt-3">
                    <TrendBars points={analytics.features.dailyNodes} barClassName="bg-brand-500" />
                  </div>
                </div>
                <div>
                  <h4 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                    <FileText size={14} className="text-warning-600" />
                    RAG documents per day
                  </h4>
                  <div className="mt-3">
                    <TrendBars points={analytics.features.dailyDocuments} barClassName="bg-warning-500" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
