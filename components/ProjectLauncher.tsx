"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import {
  ActiveSkillChip,
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useLanguage } from "@/components/language/LanguageProvider";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import type { ChatAttachment, ChatModelSelection, ChatSkill } from "@/lib/types";

type ProjectLauncherProps = {
  compact?: boolean;
  variant?: "default" | "composer";
};

export function ProjectLauncher({ compact = false, variant = "default" }: ProjectLauncherProps) {
  if (variant === "composer") return <ComposerProjectLauncher />;
  return <DefaultProjectLauncher compact={compact} />;
}

function useProjectLauncherState() {
  const router = useRouter();
  const launcherId = useId();
  const topicInputId = `${launcherId}-topic`;
  const errorId = `${launcherId}-error`;
  const statusId = `${launcherId}-status`;
  const [topic, setTopic] = useState("");
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const createProject = useBranchMindStore((state) => state.createProject);
  const creatingProject = useBranchMindStore((state) => state.creatingProject);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  async function submitProject(
    trimmedTopic: string,
    attachments?: ChatAttachment[],
    modelSelection?: ChatModelSelection,
    skill?: ChatSkill,
  ) {
    clearAiError();
    const projectId = await createProject(trimmedTopic, attachments, modelSelection, skill);
    if (projectId) {
      const path = `/workspace/${projectId}`;
      router.push(path);
    }
    return projectId;
  }

  return {
    aiError,
    clearAiError,
    creatingProject,
    errorId,
    statusId,
    submitProject,
    topic,
    topicInputId,
    setTopic,
  };
}

function ComposerProjectLauncher() {
  const { copy } = useLanguage();
  const {
    aiError,
    clearAiError,
    creatingProject,
    errorId,
    statusId,
    submitProject,
    topic,
    topicInputId,
    setTopic,
  } = useProjectLauncherState();
  const composerControls = useChatComposerControls({ isBusy: creatingProject });
  const isSubmitting = creatingProject || composerControls.isPreparingAttachments;
  const displayError = composerControls.attachmentError ?? aiError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || isSubmitting) return;

    clearAiError();
    const preparedAttachments = await composerControls.prepareAttachmentsForSend();
    if (!preparedAttachments) return;
    const skill = composerControls.prepareSkillForSend();
    const projectId = await submitProject(
      trimmed,
      preparedAttachments,
      composerControls.modelSelection,
      skill,
    );
    if (projectId) {
      setTopic("");
      composerControls.resetAttachments();
    }
  }

  return (
    <section
      aria-label={copy.projects.projectLauncher}
      data-testid="project-launcher"
      className="w-full space-y-3"
    >
      <form
        onSubmit={handleSubmit}
        aria-label={copy.projects.createProject}
        aria-busy={isSubmitting}
        aria-describedby={displayError ? errorId : isSubmitting ? statusId : undefined}
        data-testid="create-project-form"
        className="rounded-[22px] border border-white/90 bg-white/88 p-3 text-left shadow-xl backdrop-blur md:rounded-[28px] md:p-5 md:shadow-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="rounded-full bg-success-50 px-3 py-1.5 text-[11px] font-black text-success-700">
            {copy.settings.localWorkspace}
          </span>
        </div>
        <div className="mt-3">
          <PendingAttachmentChips
            attachments={composerControls.pendingAttachments}
            disabled={isSubmitting}
            onRemove={composerControls.removePendingAttachment}
          />
          {composerControls.activeSkill && (
            <div className="mt-2">
              <ActiveSkillChip
                skill={composerControls.activeSkill}
                disabled={isSubmitting}
                onRemove={composerControls.removeActiveSkill}
              />
            </div>
          )}
        </div>

        <div className="relative mt-3 rounded-[20px] border border-neutral-200 bg-surface-soft shadow-sm transition focus-within:border-brand-300 focus-within:bg-white focus-within:shadow-lg focus-within:shadow-brand-100/30 focus-within:ring-4 focus-within:ring-brand-100/50">
          <label className="sr-only" htmlFor={topicInputId}>
            {copy.projects.topic}
          </label>
          <textarea
            id={topicInputId}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(displayError)}
            aria-describedby={displayError ? errorId : undefined}
            data-testid="project-topic-input"
            placeholder={copy.projects.topicPlaceholder}
            rows={1}
            className="min-h-11 w-full resize-none bg-transparent px-4 pt-4 pb-16 text-base leading-6 text-neutral-900 outline-none transition placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-70 md:min-h-28 md:text-lg md:leading-8"
          />
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <AttachmentMenuButton controls={composerControls} />
            <ModelSelectorButton controls={composerControls} />
          </div>
          <div className="absolute bottom-3 right-3">
            <button
              type="submit"
              disabled={isSubmitting || !topic.trim()}
              aria-label={copy.projects.newProject}
              data-testid="create-project-button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              <span>{isSubmitting ? copy.common.creating : copy.projects.newProject}</span>
            </button>
          </div>
        </div>

        <div className="mt-3 hidden flex-wrap gap-2 md:flex">
          {copy.home.suggestions[0].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={isSubmitting}
              onClick={() => setTopic(suggestion)}
              className="rounded-[16px] border border-neutral-200 bg-white/75 px-3 py-2 text-sm font-bold text-neutral-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
      {isSubmitting && (
        <p
          id={statusId}
          role="status"
          data-testid="create-project-status"
          className="sr-only"
        >
          {copy.projects.createProjectStatus}
        </p>
      )}
      {displayError && (
        <p
          id={errorId}
          role="alert"
          data-testid="create-project-error-alert"
          className="rounded-[18px] bg-danger-100 px-4 py-3 text-sm font-bold text-danger-600"
        >
          {displayError}
        </p>
      )}
    </section>
  );
}

function DefaultProjectLauncher({ compact = false }: Pick<ProjectLauncherProps, "compact">) {
  const { copy } = useLanguage();
  const {
    aiError,
    creatingProject,
    errorId,
    statusId,
    submitProject,
    topic,
    topicInputId,
    setTopic,
  } = useProjectLauncherState();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || creatingProject) return;

    await submitProject(trimmed);
  }

  return (
    <section
      aria-label={copy.projects.projectLauncher}
      data-testid="project-launcher"
      className="w-full space-y-3"
    >
      <form
        onSubmit={handleSubmit}
        aria-label={copy.projects.createProject}
        aria-busy={creatingProject}
        aria-describedby={aiError ? errorId : creatingProject ? statusId : undefined}
        data-testid="create-project-form"
        className={`flex w-full gap-3 ${compact ? "flex-col sm:flex-row" : "flex-col md:flex-row"}`}
      >
        <label className="sr-only" htmlFor={topicInputId}>
          {copy.projects.topic}
        </label>
        <input
          id={topicInputId}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={creatingProject}
          aria-invalid={Boolean(aiError)}
          aria-describedby={aiError ? errorId : undefined}
          data-testid="project-topic-input"
          placeholder={copy.projects.topicPlaceholder}
          className="min-h-14 flex-1 rounded-[22px] border border-white/80 bg-white/80 px-5 text-base text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-70 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
        />
        <button
          type="submit"
          disabled={creatingProject || !topic.trim()}
          aria-label={copy.projects.newProject}
          data-testid="create-project-button"
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-[22px] bg-brand-600 px-5 font-bold text-white shadow-lg shadow-brand-200/30 transition hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0"
        >
          {creatingProject ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Sparkles size={18} />
          )}
          {creatingProject ? copy.common.creating : copy.projects.newProject}
          <ArrowRight size={18} />
        </button>
      </form>
      {creatingProject && (
        <p
          id={statusId}
          role="status"
          data-testid="create-project-status"
          className="sr-only"
        >
          {copy.projects.createProjectStatus}
        </p>
      )}
      {aiError && (
        <p
          id={errorId}
          role="alert"
          data-testid="create-project-error-alert"
          className="rounded-[18px] bg-danger-100 px-4 py-3 text-sm font-bold text-danger-600"
        >
          {aiError}
        </p>
      )}
    </section>
  );
}
