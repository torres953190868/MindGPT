"use client";

import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useCurriculumGenerationStore } from "@/store/useCurriculumGenerationStore";
import type { CurriculumRunStage } from "@/lib/agent-runtime/stream-events";

const STAGE_ORDER: CurriculumRunStage[] = [
  "intake",
  "planning",
  "searching",
  "fetching_sources",
  "extracting_concepts",
  "building_graph",
  "validating",
  "repairing",
  "saving_draft",
];

export function CurriculumGenerationPanel() {
  const { copy } = useLanguage();
  const state = useCurriculumGenerationStore();
  const copySection = copy.curriculumGeneration;

  const activeStageIndex = state.stage ? STAGE_ORDER.indexOf(state.stage) : -1;
  const isTerminal = state.status === "completed" || state.status === "failed" || state.status === "cancelled";
  const isBusy =
    state.status === "streaming" ||
    state.status === "reconnecting" ||
    state.status === "polling" ||
    state.status === "resuming" ||
    state.status === "cancelling";

  if (state.status === "idle") {
    return (
      <div
        data-testid="curriculum-generation-panel"
        className="rounded-xl border border-neutral-200 bg-white/90 p-4 text-sm text-neutral-500 shadow-sm"
      >
        {copySection.subtitle}
      </div>
    );
  }

  return (
    <div
      data-testid="curriculum-generation-panel"
      className="space-y-4 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              state.status === "failed"
                ? "bg-danger-100 text-danger-600"
                : state.status === "cancelled"
                  ? "bg-neutral-100 text-neutral-500"
                  : state.status === "completed"
                    ? "bg-success-100 text-success-600"
                    : "bg-brand-100 text-brand-600"
            }`}
          >
            {state.status === "failed" ? (
              <AlertCircle size={16} />
            ) : state.status === "cancelled" ? (
              <XCircle size={16} />
            ) : state.status === "completed" ? (
              <CheckCircle2 size={16} />
            ) : (
              <Loader2 size={16} className="animate-spin" />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-900">
              {state.status === "completed"
                ? copySection.completedTitle
                : state.status === "failed"
                  ? copySection.failedTitle
                  : state.status === "cancelled"
                    ? copySection.cancelledTitle
                    : state.status === "reconnecting"
                      ? copySection.reconnecting
                      : state.status === "polling"
                        ? copySection.polling
                        : copySection.generating}
            </h3>
            {state.stage && (
              <p className="truncate text-xs text-neutral-500">
                {copySection.stageLabel}: {copySection.stages[state.stage] ?? state.stage}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {state.status === "failed" && state.runId && (
            <button
              type="button"
              data-testid="curriculum-resume-button"
              onClick={() => void state.resumeGeneration(state.runId!)}
              disabled={isBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} />
              {copySection.resumeButton}
            </button>
          )}
          {state.status === "cancelled" && state.runId && (
            <button
              type="button"
              data-testid="curriculum-resume-button"
              onClick={() => void state.resumeGeneration(state.runId!)}
              disabled={isBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} />
              {copySection.retryButton}
            </button>
          )}
          {isBusy && (
            <button
              type="button"
              data-testid="curriculum-cancel-button"
              onClick={() => void state.cancelGeneration()}
              disabled={state.status === "cancelling"}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <XCircle size={13} />
              {copySection.cancelButton}
            </button>
          )}
        </div>
      </div>

      {/* Stage progress */}
      <div className="space-y-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500"
            style={{
              width: `${Math.max(
                5,
                activeStageIndex >= 0
                  ? ((activeStageIndex + 1) / STAGE_ORDER.length) * 100
                  : 0,
              )}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-bold text-neutral-400">
          {STAGE_ORDER.slice(0, 3).map((stage) => (
            <span key={stage} className={state.stage === stage ? "text-brand-600" : ""}>
              {copySection.stages[stage]}
            </span>
          ))}
          <span className="hidden sm:inline">...</span>
          <span className={state.stage === "saving_draft" ? "text-brand-600" : ""}>
            {copySection.stages.saving_draft}
          </span>
        </div>
      </div>

      {/* Searches */}
      {state.searches.length > 0 && (
        <div className="space-y-2 rounded-lg bg-surface-soft p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
            <Search size={13} className="text-brand-500" />
            {copySection.searchesLabel}
          </h4>
          <ul className="space-y-1.5">
            {state.searches.map((search, index) => (
              <li
                key={`${search.query}-${index}`}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate text-neutral-700">{search.query}</span>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-neutral-500">
                  {search.completed
                    ? `${search.resultCount ?? 0}`
                    : copySection.noResultCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Selected sources */}
      {state.selectedSources.length > 0 && (
        <div className="space-y-2 rounded-lg bg-surface-soft p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
            <BookOpen size={13} className="text-brand-500" />
            {copySection.sourcesLabel}
          </h4>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {state.selectedSources.map((source) => (
              <li key={source.url} className="text-xs">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-medium text-brand-700 underline-offset-2 hover:underline"
                  title={source.title}
                >
                  {source.title}
                </a>
                <span className="text-[10px] text-neutral-500">
                  {source.publisher ?? source.sourceType} ·{" "}
                  {Math.round((source.qualityScore ?? 0) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Validation */}
      {state.validation && (
        <div className="space-y-2 rounded-lg bg-surface-soft p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
            <ShieldCheck size={13} className="text-brand-500" />
            {copySection.validationLabel}
          </h4>
          <div className="flex items-center gap-3 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-bold ${
                state.validation.blockingCount > 0
                  ? "bg-danger-100 text-danger-700"
                  : "bg-success-100 text-success-700"
              }`}
            >
              {state.validation.blockingCount > 0
                ? `${state.validation.blockingCount} blocking`
                : "Valid"}
            </span>
            {state.validation.advisoryCount > 0 && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-bold text-neutral-600">
                {state.validation.advisoryCount} advisory
              </span>
            )}
          </div>
        </div>
      )}

      {/* Draft saved / completed */}
      {state.draftVersionId && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-success-200 bg-success-50 px-3 py-2">
          <span className="text-xs font-bold text-success-800">
            {copySection.draftSavedLabel}: {state.draftVersionId.slice(0, 12)}
          </span>
          <a
            href={`#version-${state.draftVersionId}`}
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            {copySection.viewVersionLink}
          </a>
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">
          {state.error.code ? `${state.error.code}: ` : ""}
          {state.error.message}
        </div>
      )}

      {/* Connection status */}
      {!isTerminal && !state.isConnected && (state.status === "polling" || state.status === "reconnecting") && (
        <p className="text-[11px] text-neutral-500">
          {state.status === "reconnecting" ? copySection.reconnecting : copySection.polling}
        </p>
      )}
    </div>
  );
}
