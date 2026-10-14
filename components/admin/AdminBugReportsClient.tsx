"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Image as ImageIcon, Loader2, RefreshCcw, Save } from "lucide-react";
import type { AdminBugReportDto, BugReportStatus } from "@/lib/types";

type BugReportsResponse = {
  reports: AdminBugReportDto[];
};

const FILTERS: Array<BugReportStatus | "all"> = ["open", "triaged", "fixed", "closed", "all"];
const STATUSES: BugReportStatus[] = ["open", "triaged", "fixed", "closed"];

const cardClassName =
  "rounded-lg border border-neutral-200 bg-surface-elevated shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const fieldClassName =
  "min-h-10 w-full rounded-lg border border-neutral-200 bg-surface-elevated px-3 py-2 text-sm font-semibold text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-surface-muted disabled:text-text-muted";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(60,45,30,0.2)] transition hover:-translate-y-0.5 hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-text-muted disabled:shadow-none disabled:hover:translate-y-0";

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

export function AdminBugReportsClient() {
  const [filter, setFilter] = useState<BugReportStatus | "all">("open");
  const [reports, setReports] = useState<AdminBugReportDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: BugReportStatus; adminNotes: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadReports = useCallback(async (nextFilter: BugReportStatus | "all" = filter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/bug-reports?status=${nextFilter}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as BugReportsResponse;
      setReports(data.reports);
      setDrafts(
        Object.fromEntries(
          data.reports.map((report) => [
            report.id,
            {
              status: report.status,
              adminNotes: report.adminNotes ?? "",
            },
          ]),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load bug reports.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadReports(filter);
  }, [filter, loadReports]);

  async function saveReport(reportId: string) {
    const draft = drafts[reportId];
    if (!draft) return;

    setSaving(reportId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/bug-reports/${reportId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: draft.status,
          adminNotes: draft.adminNotes || null,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as { report: AdminBugReportDto };
      setReports((current) =>
        current.map((report) => (report.id === reportId ? data.report : report)),
      );
      setMessage("Bug report updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save bug report.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className={`${cardClassName} flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between`}>
        <div>
          <h2 className="text-base font-black text-neutral-900">Bug reports</h2>
          <p className="mt-1 text-sm font-semibold text-text-muted">Reports submitted from the user menu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`min-h-9 rounded-lg px-3 text-sm font-black capitalize transition ${
                filter === item
                  ? "bg-brand-900 text-white shadow-[0_10px_24px_rgba(60,45,30,0.18)]"
                  : "border border-border-default bg-surface-elevated text-text-secondary hover:border-border-default hover:bg-white"
              }`}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void loadReports(filter)}
            className={secondaryButtonClassName}
          >
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </section>

      {(message || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-bold ${
            error
              ? "border-danger-200 bg-danger-50 text-danger-600"
              : "border-success-200 bg-success-50 text-success-700"
          }`}
        >
          {error ?? message}
        </div>
      )}

      {loading ? (
        <div className={`${cardClassName} grid min-h-80 place-items-center`}>
          <Loader2 size={24} className="animate-spin text-text-muted" />
        </div>
      ) : reports.length === 0 ? (
        <div className={`${cardClassName} p-8 text-center`}>
          <p className="font-black text-neutral-900">No reports in this queue.</p>
          <p className="mt-1 text-sm font-semibold text-text-muted">That is the kind of quiet we like.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reports.map((report) => {
            const draft = drafts[report.id] ?? {
              status: report.status,
              adminNotes: report.adminNotes ?? "",
            };

            return (
              <article key={report.id} className={`${cardClassName} p-5`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-success-50 px-2.5 py-1 text-xs font-black uppercase text-success-700">
                        {report.status}
                      </span>
                      <span className="font-mono text-xs text-text-muted">{new Date(report.createdAt).toLocaleString()}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-black text-neutral-900">{report.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-text-secondary">{report.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {report.currentUrl && (
                      <a href={report.currentUrl} target="_blank" rel="noreferrer" className={secondaryButtonClassName}>
                        <ExternalLink size={14} />
                        Page
                      </a>
                    )}
                    {report.screenshotUrl && (
                      <a href={report.screenshotUrl} target="_blank" rel="noreferrer" className={secondaryButtonClassName}>
                        <ImageIcon size={14} />
                        Screenshot
                      </a>
                    )}
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 border-t border-neutral-200 pt-4 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-black uppercase tracking-[0.12em] text-text-muted">Reporter</dt>
                    <dd className="mt-1 font-semibold text-text-secondary">
                      {report.reporterEmail ?? report.contactEmail ?? "Anonymous"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-black uppercase tracking-[0.12em] text-text-muted">User agent</dt>
                    <dd className="mt-1 truncate font-mono text-xs text-text-muted">{report.userAgent ?? "unknown"}</dd>
                  </div>
                </dl>

                <div className="mt-4 grid gap-3 lg:grid-cols-[180px_1fr_auto] lg:items-start">
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [report.id]: { ...draft, status: event.target.value as BugReportStatus },
                      })
                    }
                    className={fieldClassName}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                  <textarea
                    value={draft.adminNotes}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [report.id]: { ...draft, adminNotes: event.target.value },
                      })
                    }
                    placeholder="Admin notes"
                    className={`${fieldClassName} min-h-20`}
                  />
                  <button
                    type="button"
                    onClick={() => void saveReport(report.id)}
                    disabled={saving === report.id}
                    className={primaryButtonClassName}
                  >
                    {saving === report.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Save
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
