"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { useBranchMindStore } from "@/store/useBranchMindStore";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || creatingProject) return;

    clearAiError();
    const projectId = await createProject(trimmed);
    if (projectId) {
      const path = `/workspace/${projectId}`;
      router.push(path);
      window.setTimeout(() => {
        if (window.location.pathname !== path) window.location.assign(path);
      }, 100);
    }
  }

  if (variant === "composer") {
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
          className="rounded-[22px] border border-white/90 bg-white/88 p-3 text-left shadow-xl shadow-[#d6c7e8]/30 backdrop-blur md:rounded-[28px] md:p-5 md:shadow-2xl"
        >
          <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 items-center gap-2 rounded-[16px] border border-[#eee4f8] bg-white/80 px-3 text-sm font-black text-[#5d5168] shadow-sm">
                <Sparkles size={16} />
                DeepSeek
              </span>
              <button
                type="button"
                aria-label="Add context"
                className="grid h-11 w-11 place-items-center rounded-[16px] border border-[#eee4f8] bg-white/80 text-[#6d5a78] shadow-sm transition hover:bg-white"
              >
                <Plus size={18} />
              </button>
            </div>
            <span className="rounded-full bg-[#e5f6ee] px-3 py-2 text-xs font-black text-[#3d7558]">
              Private workspace
            </span>
          </div>

          <label className="sr-only" htmlFor={topicInputId}>
            Topic
          </label>
          <textarea
            id={topicInputId}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            disabled={creatingProject}
            aria-invalid={Boolean(aiError)}
            aria-describedby={aiError ? errorId : undefined}
            data-testid="project-topic-input"
            placeholder="Start with a research question..."
            rows={1}
            className="min-h-11 w-full resize-none rounded-[18px] border border-transparent bg-transparent px-1 py-1 text-base leading-6 text-[#332b38] outline-none transition placeholder:text-[#8a7f91] disabled:cursor-not-allowed disabled:opacity-70 focus:border-transparent md:mt-5 md:min-h-28 md:text-lg md:leading-8"
          />

          <div className="mt-2 flex items-center justify-between gap-2 md:mt-4 md:items-end">
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <button
                type="button"
                aria-label="Add context"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#eee4f8] bg-white/80 text-[#6d5a78] shadow-sm transition hover:bg-white"
              >
                <Plus size={18} />
              </button>
              <span className="inline-flex h-10 min-w-0 items-center gap-2 rounded-full px-1 text-sm font-black text-[#5d5168]">
                <Sparkles size={16} className="shrink-0 text-[#8f7d9a]" />
                <span className="truncate">DeepSeek</span>
              </span>
            </div>
            <div className="hidden flex-wrap gap-2 md:flex">
              {suggestionTopics.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={creatingProject}
                  onClick={() => setTopic(suggestion)}
                  className="rounded-[16px] border border-[#ebe4f2] bg-white/75 px-3 py-2 text-sm font-bold text-[#5f5368] shadow-sm transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={creatingProject || !topic.trim()}
              aria-label="Create new project"
              data-testid="create-project-button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#7c5fb1] font-bold text-white shadow-lg shadow-[#b99adb]/25 transition hover:-translate-y-0.5 hover:bg-[#6e53a2] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0 md:inline-flex md:min-h-12 md:w-auto md:min-w-44 md:gap-2 md:rounded-[20px] md:px-5"
            >
              <Sparkles size={18} className="hidden md:block" />
              <span className="sr-only md:not-sr-only">
                {creatingProject ? "Calling DeepSeek..." : "New Project"}
              </span>
              <ArrowRight size={18} />
            </button>
          </div>
        </form>
        {creatingProject && (
          <p
            id={statusId}
            role="status"
            data-testid="create-project-status"
            className="sr-only"
          >
            Creating project with DeepSeek.
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
          <Sparkles size={18} />
          {creatingProject ? "Calling DeepSeek..." : "New Project"}
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
          Creating project with DeepSeek.
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
