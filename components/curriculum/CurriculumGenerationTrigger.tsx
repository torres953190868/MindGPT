"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useCurriculumGenerationStore } from "@/store/useCurriculumGenerationStore";
import { createCurriculum } from "@/lib/client/curriculum-api";
import type { CurriculumBuildRequest } from "@/lib/curriculum/curriculum-types";
import {
  getCurriculumGenerationQuota,
  type CurriculumGenerationQuota,
} from "@/lib/client/curriculum-api";
import {
  buildCurriculumBuildRequest,
  isCurriculumGenerationQuotaExhausted,
  type CurriculumGenerationFormValues,
} from "./curriculum-form-helpers";

export type CurriculumGenerationTriggerProps = {
  curriculumId?: string | null;
  onCurriculumCreated?: (curriculumId: string) => void;
};

export function CurriculumGenerationTrigger({ curriculumId = null, onCurriculumCreated }: CurriculumGenerationTriggerProps) {
  const { copy } = useLanguage();
  const state = useCurriculumGenerationStore();
  const reconnectIfNeeded = useCurriculumGenerationStore((store) => store.reconnectIfNeeded);
  const copySection = copy.curriculumGeneration;

  const [subject, setSubject] = useState("");
  const [learningGoal, setLearningGoal] = useState("");
  const [currentLevel, setCurrentLevel] = useState<CurriculumBuildRequest["learnerProfile"]["currentLevel"]>(
    "beginner",
  );
  const [durationWeeks, setDurationWeeks] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [includeMathDepth, setIncludeMathDepth] = useState<
    CurriculumGenerationFormValues["includeMathDepth"]
  >("standard");
  const [includeProjects, setIncludeProjects] = useState(false);
  const [quota, setQuota] = useState<CurriculumGenerationQuota | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreatingCurriculum, setIsCreatingCurriculum] = useState(false);

  useEffect(() => {
    if (!curriculumId) return;
    void reconnectIfNeeded(curriculumId);
    return () => {
      // Intentionally not resetting the store on unmount so that background
      // generation survives navigation. Polls are stopped by reset()/startGeneration().
    };
  }, [curriculumId, reconnectIfNeeded]);

  useEffect(() => {
    let active = true;
    void getCurriculumGenerationQuota()
      .then((result) => {
        if (!active) return;
        setQuota(result.quota);
      })
      .catch(() => {
        if (active) setQuotaError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const isBusy =
    isCreatingCurriculum ||
    state.status === "streaming" ||
    state.status === "reconnecting" ||
    state.status === "polling" ||
    state.status === "resuming" ||
    state.status === "cancelling";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;

    const trimmedSubject = subject.trim();
    const trimmedGoal = learningGoal.trim();
    if (!trimmedSubject || !trimmedGoal) return;

    if (isCurriculumGenerationQuotaExhausted(quota)) return;

    const request: CurriculumBuildRequest = buildCurriculumBuildRequest({
      subject: trimmedSubject,
      learningGoal: trimmedGoal,
      currentLevel,
      durationWeeks,
      hoursPerWeek,
      includeMathDepth,
      includeProjects,
    });

    setCreationError(null);
    setIsCreatingCurriculum(true);

    try {
      let generationCurriculumId = curriculumId;
      if (!generationCurriculumId) {
        const result = await createCurriculum({
          title: trimmedSubject,
          subject: trimmedSubject,
          learningGoal: trimmedGoal,
        });
        generationCurriculumId = result.curriculum.id;
      }

      const generation = state.startGeneration(generationCurriculumId, request);
      onCurriculumCreated?.(generationCurriculumId);
      await generation;
    } catch (createError) {
      setCreationError(createError instanceof Error ? createError.message : copy.curriculumList.createError);
    } finally {
      setIsCreatingCurriculum(false);
    }
  }

  return (
    <form
      data-testid="curriculum-generation-trigger"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm"
    >
      <div>
        <label
          htmlFor="curriculum-subject"
          className="mb-1.5 block text-xs font-bold text-neutral-700"
        >
          {copySection.subjectLabel}
        </label>
        <input
          id="curriculum-subject"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={copySection.subjectPlaceholder}
          disabled={isBusy}
          className="h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div>
        <label
          htmlFor="curriculum-learning-goal"
          className="mb-1.5 block text-xs font-bold text-neutral-700"
        >
          {copySection.learningGoalLabel}
        </label>
        <textarea
          id="curriculum-learning-goal"
          value={learningGoal}
          onChange={(event) => setLearningGoal(event.target.value)}
          placeholder={copySection.learningGoalPlaceholder}
          disabled={isBusy}
          rows={3}
          className="w-full resize-none rounded-lg border border-neutral-200 bg-surface-soft px-3 py-2 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="curriculum-level"
            className="mb-1.5 block text-xs font-bold text-neutral-700"
          >
            {copySection.currentLevelLabel}
          </label>
          <select
            id="curriculum-level"
            value={currentLevel}
            onChange={(event) =>
              setCurrentLevel(event.target.value as CurriculumBuildRequest["learnerProfile"]["currentLevel"])
            }
            disabled={isBusy}
            className="h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-900 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="beginner">{copySection.beginner}</option>
            <option value="intermediate">{copySection.intermediate}</option>
          <option value="advanced">{copySection.advanced}</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="curriculum-weeks"
              className="mb-1.5 block text-xs font-bold text-neutral-700"
            >
              {copySection.durationWeeksLabel}
            </label>
            <input
              id="curriculum-weeks"
              type="number"
              min={1}
              max={520}
              value={durationWeeks}
              onChange={(event) => setDurationWeeks(event.target.value)}
              disabled={isBusy}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <div>
            <label
              htmlFor="curriculum-hours"
              className="mb-1.5 block text-xs font-bold text-neutral-700"
            >
              {copySection.hoursPerWeekLabel}
            </label>
            <input
              id="curriculum-hours"
              type="number"
              min={1}
              max={80}
              value={hoursPerWeek}
              onChange={(event) => setHoursPerWeek(event.target.value)}
              disabled={isBusy}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="curriculum-math-depth"
            className="mb-1.5 block text-xs font-bold text-neutral-700"
          >
            {copySection.includeMathDepthLabel}
          </label>
          <select
            id="curriculum-math-depth"
            value={includeMathDepth}
            onChange={(event) =>
              setIncludeMathDepth(event.target.value as CurriculumGenerationFormValues["includeMathDepth"])
            }
            disabled={isBusy}
            className="h-10 w-full rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-900 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-4 focus:ring-brand-100/45 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="light">{copySection.mathLight}</option>
            <option value="standard">{copySection.mathStandard}</option>
            <option value="deep">{copySection.mathDeep}</option>
          </select>
        </div>

        <label className="flex min-h-10 items-center gap-3 rounded-lg border border-neutral-200 bg-surface-soft px-3 text-sm text-neutral-800">
          <input
            id="curriculum-include-projects"
            type="checkbox"
            checked={includeProjects}
            onChange={(event) => setIncludeProjects(event.target.checked)}
            disabled={isBusy}
            className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-200"
          />
          <span>
            <span className="block text-xs font-bold">{copySection.includeProjectsLabel}</span>
            <span className="block text-[11px] text-neutral-500">{copySection.includeProjectsDescription}</span>
          </span>
        </label>
      </div>

      <div
        data-testid="curriculum-generation-quota"
        className="space-y-1.5 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2.5 text-xs text-brand-900"
      >
        <p className="font-bold">
          {quotaError
            ? copySection.quotaUnavailable
            : quota === null
              ? copySection.quotaLoading
              : quota.remaining !== null
                ? copySection.quotaRemaining(quota.remaining)
                : quota.tracked
                  ? copySection.quotaUnlimited
                  : copySection.quotaLocal}
        </p>
        <p data-testid="curriculum-generation-estimate" className="text-brand-800">
          {copySection.estimatedDuration}
        </p>
        {isCurriculumGenerationQuotaExhausted(quota) && <p className="font-bold text-danger-700">{copySection.quotaExhausted}</p>}
      </div>

      {creationError && <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs font-bold text-danger-700">{creationError}</p>}

      <button
        type="submit"
        disabled={isBusy || !subject.trim() || !learningGoal.trim() || isCurriculumGenerationQuotaExhausted(quota)}
        data-testid="curriculum-generate-button"
        className="branchmind-primary-action inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBusy ? <span className="animate-pulse">{copySection.generating}</span> : copySection.generateButton}
        {!isBusy && <Sparkles size={15} className="shrink-0" />}
      </button>
    </form>
  );
}
