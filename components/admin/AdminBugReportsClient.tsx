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
  "rounded-lg border border-[#e4ddd4] bg-[#fffdf9] shadow-[0_14px_34px_rgba(35,31,26,0.06)]";

const fieldClassName =
  "min-h-10 w-full rounded-lg border border-[#ded6cc] bg-[#fffdf9] px-3 py-2 text-sm font-semibold text-[#28242d] outline-none transition placeholder:text-[#aaa19a] focus:border-[#6f6256] focus:ring-2 focus:ring-[#e8dfd3] disabled:cursor-not-allowed disabled:border-[#e5dfd7] disabled:bg-[#f4f1eb] disabled:text-[#9a928a]";

const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#25222b] px-4 text-sm font-black text-white shadow-[0_12px_26px_rgba(37,34,43,0.2)] transition hover:-translate-y-0.5 hover:bg-[#17151b] disabled:cursor-not-allowed disabled:bg-[#d9d3ca] disabled:text-[#8a8178] disabled:shadow-none disabled:hover:translate-y-0";

const secondaryButtonClassName =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#ddd5cb] bg-[#fffdf9] px-3 text-sm font-bold text-[#4f4650] shadow-[0_1px_2px_rgba(35,31,26,0.05)] transition hover:border-[#cfc5b8] hover:bg-white";

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
          <h2 className="text-base font-black text-[#25222b]">Bug reports</h2>
          <p className="mt-1 text-sm font-semibold text-[#7b717f]">Reports submitted from the user menu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`min-h-9 rounded-lg px-3 text-sm font-black capitalize transition ${
                filter === item
                  ? "bg-[#25222b] text-white shadow-[0_10px_24px_rgba(37,34,43,0.18)]"
                  : "border border-[#ddd5cb] bg-[#fffdf9] text-[#5d5363] hover:border-[#cfc5b8] hover:bg-white"
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
              ? "border-[#f0cfcb] bg-[#fff0ef] text-[#8f3f3a]"
              : "border-[#d6e4dc] bg-[#edf3ef] text-[#2f6651]"
          }`}
        >
          {error ?? message}
        </div>
      )}

      {loading ? (
        <div className={`${cardClassName} grid min-h-80 place-items-center`}>
          <Loader2 size={24} className="animate-spin text-[#7b717f]" />
        </div>
      ) : reports.length === 0 ? (
        <div className={`${cardClassName} p-8 text-center`}>
          <p className="font-black text-[#25222b]">No reports in this queue.</p>
          <p className="mt-1 text-sm font-semibold text-[#7b717f]">That is the kind of quiet we like.</p>
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
                      <span className="rounded-full bg-[#eaf4ef] px-2.5 py-1 text-xs font-black uppercase text-[#2f6651]">
                        {report.status}
                      </span>
                      <span className="font-mono text-xs text-[#8c828f]">{new Date(report.createdAt).toLocaleString()}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-black text-[#25222b]">{report.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#5c5360]">{report.description}</p>
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

                <dl className="mt-4 grid gap-3 border-t border-[#e4ddd4] pt-4 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-black uppercase tracking-[0.12em] text-[#8c828f]">Reporter</dt>
                    <dd className="mt-1 font-semibold text-[#5c5360]">
                      {report.reporterEmail ?? report.contactEmail ?? "Anonymous"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-black uppercase tracking-[0.12em] text-[#8c828f]">User agent</dt>
                    <dd className="mt-1 truncate font-mono text-xs text-[#716675]">{report.userAgent ?? "unknown"}</dd>
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
