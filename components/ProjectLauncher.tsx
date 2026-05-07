"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { useBranchMindStore } from "@/store/useBranchMindStore";

type ProjectLauncherProps = {
  compact?: boolean;
};

export function ProjectLauncher({ compact = false }: ProjectLauncherProps) {
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
