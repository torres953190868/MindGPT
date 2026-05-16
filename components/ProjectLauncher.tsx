"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import {
  AttachmentMenuButton,
  ModelSelectorButton,
  PendingAttachmentChips,
  useChatComposerControls,
} from "@/components/chat/ChatComposerControls";
import { useBranchMindStore } from "@/store/useBranchMindStore";
import type { ChatAttachment, ChatModelSelection } from "@/lib/types";

type ProjectLauncherProps = {
  compact?: boolean;
  variant?: "default" | "composer";
};

const suggestionTopics = [
  "explain reinforcement learning",
  "map a research paper",
  "compare policy gradients",
];

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
  ) {
    clearAiError();
    const projectId = await createProject(trimmedTopic, attachments, modelSelection);
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
    const projectId = await submitProject(
      trimmed,
      preparedAttachments,
      composerControls.selectedModel,
    );
    if (projectId) {
      setTopic("");
      composerControls.resetAttachments();
    }
  }

  return (
    <section
      aria-label="Project launcher"
      data-testid="project-launcher"
      className="w-full space-y-3"
    >
      <form
        onSubmit={handleSubmit}
        aria-label="Create project"
        aria-busy={isSubmitting}
        aria-describedby={displayError ? errorId : isSubmitting ? statusId : undefined}
        data-testid="create-project-form"
        className="rounded-[22px] border border-white/90 bg-white/88 p-3 text-left shadow-xl shadow-[#d6c7e8]/30 backdrop-blur md:rounded-[28px] md:p-5 md:shadow-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <AttachmentMenuButton controls={composerControls} placement="below" />
            <ModelSelectorButton controls={composerControls} placement="below" />
          </div>
          <span className="rounded-full bg-[#e5f6ee] px-3 py-2 text-xs font-black text-[#3d7558]">
            Private workspace
          </span>
        </div>
        <div className="mt-3">
          <PendingAttachmentChips
            attachments={composerControls.pendingAttachments}
            disabled={isSubmitting}
            onRemove={composerControls.removePendingAttachment}
          />
        </div>

        <label className="sr-only" htmlFor={topicInputId}>
          Topic
        </label>
        <textarea
          id={topicInputId}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={Boolean(displayError)}
          aria-describedby={displayError ? errorId : undefined}
          data-testid="project-topic-input"
          placeholder="Start with a research question..."
          rows={1}
          className="min-h-11 w-full resize-none rounded-[18px] border border-transparent bg-transparent px-1 py-1 text-base leading-6 text-[#332b38] outline-none transition placeholder:text-[#8a7f91] disabled:cursor-not-allowed disabled:opacity-70 focus:border-transparent md:mt-5 md:min-h-28 md:text-lg md:leading-8"
        />

        <div className="mt-2 flex items-center justify-between gap-2 md:mt-4 md:items-end">
          <div className="min-w-0 md:hidden" />
          <div className="hidden flex-wrap gap-2 md:flex">
            {suggestionTopics.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={isSubmitting}
                onClick={() => setTopic(suggestion)}
                className="rounded-[16px] border border-[#ebe4f2] bg-white/75 px-3 py-2 text-sm font-bold text-[#5f5368] shadow-sm transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !topic.trim()}
            aria-label="Create new project"
            data-testid="create-project-button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#7c5fb1] font-bold text-white shadow-lg shadow-[#b99adb]/25 transition hover:-translate-y-0.5 hover:bg-[#6e53a2] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0 md:inline-flex md:min-h-12 md:w-auto md:min-w-44 md:gap-2 md:rounded-[20px] md:px-5"
          >
            {isSubmitting ? (
              <Loader2 size={18} className="hidden animate-spin md:block" />
            ) : (
              <Sparkles size={18} className="hidden md:block" />
            )}
            <span className="sr-only md:not-sr-only">
              {isSubmitting ? "Creating project..." : "New Project"}
            </span>
            <ArrowRight size={18} />
          </button>
        </div>
      </form>
      {isSubmitting && (
        <p
          id={statusId}
          role="status"
          data-testid="create-project-status"
          className="sr-only"
        >
          Creating project.
        </p>
      )}
      {displayError && (
        <p
          id={errorId}
          role="alert"
          data-testid="create-project-error-alert"
          className="rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          {displayError}
        </p>
      )}
    </section>
  );
}

function DefaultProjectLauncher({ compact = false }: Pick<ProjectLauncherProps, "compact">) {
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
      aria-label="Project launcher"
      data-testid="project-launcher"
      className="w-full space-y-3"
    >
      <form
        onSubmit={handleSubmit}
        aria-label="Create project"
        aria-busy={creatingProject}
        aria-describedby={aiError ? errorId : creatingProject ? statusId : undefined}
        data-testid="create-project-form"
        className={`flex w-full gap-3 ${compact ? "flex-col sm:flex-row" : "flex-col md:flex-row"}`}
      >
        <label className="sr-only" htmlFor={topicInputId}>
          Topic
        </label>
        <input
          id={topicInputId}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={creatingProject}
          aria-invalid={Boolean(aiError)}
          aria-describedby={aiError ? errorId : undefined}
          data-testid="project-topic-input"
          placeholder="Start with a research question..."
          className="min-h-14 flex-1 rounded-[22px] border border-white/80 bg-white/80 px-5 text-base text-[#332b38] shadow-sm outline-none transition placeholder:text-[#665a70] disabled:cursor-not-allowed disabled:opacity-70 focus:border-[#be8bd8] focus:ring-4 focus:ring-[#e9d3f5]"
        />
        <button
          type="submit"
          disabled={creatingProject || !topic.trim()}
          aria-label="Create new project"
          data-testid="create-project-button"
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-[22px] bg-[#7c5fb1] px-5 font-bold text-white shadow-lg shadow-[#b99adb]/30 transition hover:-translate-y-0.5 hover:bg-[#6e53a2] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0"
        >
          {creatingProject ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Sparkles size={18} />
          )}
          {creatingProject ? "Creating project..." : "New Project"}
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
          Creating project.
        </p>
      )}
      {aiError && (
        <p
          id={errorId}
          role="alert"
          data-testid="create-project-error-alert"
          className="rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          {aiError}
        </p>
      )}
    </section>
  );
}
