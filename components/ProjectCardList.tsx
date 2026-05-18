"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Brain,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  HelpCircle,
  Home,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AuthPanel } from "@/components/AuthPanel";
import { ProjectLauncher } from "@/components/ProjectLauncher";
import { downloadProjectJson, importProjectJsonFile } from "@/lib/project-export";
import { useBranchMindStore } from "@/store/useBranchMindStore";

const projectDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Import failed.";
}

function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return projectDateFormatter.format(date);
}

function formatNodeCount(count: number) {
  return `${count} ${count === 1 ? "node" : "nodes"}`;
}

export function ProjectCardList() {
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const hydrated = useBranchMindStore((state) => state.hydrated);
  const projects = useBranchMindStore((state) => state.projects);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const deleteProject = useBranchMindStore((state) => state.deleteProject);

  useEffect(() => {
    void hydrate({ force: true });
  }, [hydrate]);

  useEffect(() => {
    function refreshVisibleProjects() {
      void hydrate({ force: true });
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refreshVisibleProjects();
    }

    window.addEventListener("focus", refreshVisibleProjects);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshVisibleProjects);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hydrate]);

  useEffect(() => {
    if (!isCreateOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsCreateOpen(false);
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isCreateOpen]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(normalized));
  }, [projects, query]);

  function openImportPicker() {
    importInputRef.current?.click();
  }

  function handleDeleteProject(projectId: string, projectTitle: string) {
    const confirmed = window.confirm(
      `Delete "${projectTitle}"?\n\nThis permanently removes the project from BranchMind. Export JSON first if you need a copy.`,
    );

    if (confirmed) {
      void deleteProject(projectId);
    }
  }

  async function handleImportProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isImporting) return;

    setIsImporting(true);
    setImportError(null);
    setImportStatus(null);
    clearAiError();

    try {
      const result = await importProjectJsonFile(file);

      useBranchMindStore.setState((state) => {
        const activeProject = state.activeProjectId
          ? result.projects.find((project) => project.id === state.activeProjectId)
          : null;
        const nextActiveProject = activeProject ?? result.projects[0] ?? null;

        return {
          projects: result.projects,
          activeProjectId: nextActiveProject?.id ?? null,
          selectedNodeId:
            activeProject && state.selectedNodeId
              ? state.selectedNodeId
              : nextActiveProject?.rootNodeId ?? null,
          hydrated: true,
          aiError: null,
        };
      });

      setImportStatus(
        result.importedCount > 0
          ? `Imported ${result.importedCount} of ${result.sourceCount} project(s).`
          : "No new projects were imported. The selected project already exists.",
      );
    } catch (error) {
      setImportError(getErrorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section
      className="mx-auto flex w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-[#e5e1ec] bg-white/95 shadow-[0_18px_55px_rgba(47,39,67,0.08)] md:min-h-[calc(100vh-2rem)] md:flex-row"
      aria-labelledby="projects-title"
      data-testid="project-card-list"
    >
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        disabled={isImporting}
        onChange={handleImportProject}
        aria-label="Import BranchMind JSON project"
        data-testid="project-import-json-input"
        className="sr-only"
      />

      <aside className="flex w-full shrink-0 flex-col border-b border-[#e8e4ef] bg-white px-3 py-3 md:w-56 md:border-b-0 md:border-r">
        <Link
          href="/"
          aria-label="BranchMind home"
          className="flex min-h-11 items-center gap-2 rounded-md px-2 text-[#201a2d] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md border border-[#ddd5ec] bg-[#f7f3fb] text-[#7658b3]">
            <Brain size={18} />
          </span>
          <span className="text-base font-extrabold">BranchMind</span>
        </Link>

        <nav
          aria-label="Projects navigation"
          data-testid="projects-navigation"
          className="mt-5 grid gap-1 text-sm font-bold"
        >
          <Link
            href="/projects"
            aria-current="page"
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#e7f5f0] px-3 text-[#1f7f64] transition hover:bg-[#dff1ea] focus:outline-none focus:ring-2 focus:ring-[#9bd8c6]"
          >
            <Folder size={16} />
            Projects
          </Link>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <Clock3 size={16} />
            Recent
          </button>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <Star size={16} />
            Starred
          </button>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <Share2 size={16} />
            Shared with me
          </button>

          <div className="my-3 border-t border-[#ebe7f1]" />

          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <LayoutTemplate size={16} />
            Templates
          </button>
          <button
            type="button"
            onClick={openImportPicker}
            disabled={isImporting}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-[#4e455d] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload size={16} />
            Import
          </button>

          <div className="my-3 border-t border-[#ebe7f1]" />

          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <Settings size={16} />
            Settings
          </button>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-[#6f6678] opacity-70"
          >
            <HelpCircle size={16} />
            Help & feedback
          </button>
          <Link
            href="/reader"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-[#4e455d] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <FileText size={16} />
            PDF Reader
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-[#4e455d] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
          >
            <Home size={16} />
            Home
          </Link>
        </nav>

        <div className="mt-5 border-t border-[#ebe7f1] pt-3 md:mt-auto">
          <AuthPanel placement="top" variant="sidebar" className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[#ebe7f1] px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f1fbf7] text-[#24916f]">
              <FolderOpen size={18} />
            </span>
            <div className="min-w-0">
              <h1 id="projects-title" className="truncate text-lg font-extrabold text-[#201a2d]">
                Projects
              </h1>
              <p className="text-xs font-semibold text-[#7a7184]">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            data-testid="open-create-project-dialog-button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#8a6bc4] px-4 text-sm font-extrabold text-white shadow-sm shadow-[#d5c5f0]/70 transition hover:bg-[#795bb4] focus:outline-none focus:ring-4 focus:ring-[#e5d8f8]"
          >
            <Plus size={16} />
            New Project
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-5">
          <div
            className="flex flex-col gap-3 lg:flex-row lg:items-center"
            data-testid="project-list-toolbar"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b8294]" size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                data-testid="project-search-input"
                className="h-10 w-full rounded-md border border-[#e7e3ee] bg-white pl-9 pr-4 text-sm font-medium text-[#292234] outline-none transition placeholder:text-[#9b94a5] focus:border-[#a78ad1] focus:ring-2 focus:ring-[#d9caef]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openImportPicker}
                disabled={isImporting}
                aria-label="Import BranchMind JSON project"
                data-testid="project-import-json-button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#e5e0ec] bg-white px-3 text-sm font-extrabold text-[#5d427d] transition hover:bg-[#f7f3fb] focus:outline-none focus:ring-2 focus:ring-[#d9caef] disabled:cursor-not-allowed disabled:opacity-65"
              >
                <Upload size={16} />
                {isImporting ? "Importing..." : "Import JSON"}
              </button>
              <button
                type="button"
                disabled
                aria-label="Project filter"
                className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-[#e5e0ec] bg-white px-3 text-sm font-bold text-[#6f6678] opacity-70"
              >
                All projects
                <ChevronDown size={15} />
              </button>
            </div>
          </div>

          {importStatus && (
            <p
              role="status"
              data-testid="project-import-status"
              className="rounded-md border border-[#cdeadd] bg-[#edf9f4] px-4 py-3 text-sm font-bold text-[#2f6b54]"
            >
              {importStatus}
            </p>
          )}
          {importError && (
            <p
              role="alert"
              data-testid="project-import-error-alert"
              className="rounded-md border border-[#ffd1cf] bg-[#fff0ef] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
            >
              {importError}
            </p>
          )}
          {aiError && (
            <p
              role="alert"
              data-testid="project-list-error-alert"
              className="rounded-md border border-[#ffd1cf] bg-[#fff0ef] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
            >
              {aiError}
            </p>
          )}

          {!hydrated ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="project-list-loading-state"
              className="rounded-lg border border-[#e5e1ec] bg-white p-8 text-center text-sm font-extrabold text-[#5c5065]"
            >
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <section
              aria-label="No projects"
              data-testid="project-empty-state"
              className="rounded-lg border border-[#e5e1ec] bg-white p-8 text-center"
            >
              <h2 className="text-lg font-extrabold text-[#272033]">No projects yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-[#6f6678]">
                Create a project with New Project or import a BranchMind JSON export.
              </p>
            </section>
          ) : visibleProjects.length === 0 ? (
            <section
              aria-label="No matching projects"
              data-testid="project-search-empty-state"
              className="rounded-lg border border-[#e5e1ec] bg-white p-8 text-center"
            >
              <h2 className="text-lg font-extrabold text-[#272033]">No matching projects</h2>
              <p className="mt-2 text-sm font-semibold text-[#6f6678]">
                Try a different project title.
              </p>
            </section>
          ) : (
            <div
              className="overflow-hidden rounded-lg border border-[#e5e1ec] bg-white"
              data-testid="project-grid"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-[#ebe7f1] bg-[#fbfafc] text-xs font-extrabold text-[#655b70]">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Name
                      </th>
                      <th scope="col" className="w-28 px-4 py-3">
                        Nodes
                      </th>
                      <th scope="col" className="w-44 px-4 py-3">
                        Updated
                      </th>
                      <th scope="col" className="w-40 px-4 py-3 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ebe7f1]">
                    {visibleProjects.map((project) => {
                      const nodeCount = Object.keys(project.nodes).length;

                      return (
                        <tr
                          key={project.id}
                          data-project-id={project.id}
                          data-testid="project-card"
                          className="transition hover:bg-[#fbfafc]"
                        >
                          <td className="px-4 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <button
                                type="button"
                                disabled
                                aria-label={`Star ${project.title}`}
                                className="grid h-8 w-8 shrink-0 cursor-not-allowed place-items-center rounded-md text-[#756b80] opacity-70"
                              >
                                <Star size={15} />
                              </button>
                              <div className="min-w-0">
                                <h2 className="truncate text-sm font-extrabold text-[#262033]">
                                  {project.title}
                                </h2>
                                <p className="mt-0.5 text-xs font-semibold text-[#817789]">
                                  {formatNodeCount(nodeCount)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-[#51475d]">
                            {nodeCount}
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#6f6678]">
                            {formatProjectDate(project.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className="flex items-center justify-end gap-1"
                              role="group"
                              aria-label={`${project.title} actions`}
                            >
                              <Link
                                href={`/workspace/${project.id}`}
                                aria-label={`Open ${project.title}`}
                                data-project-id={project.id}
                                data-testid="open-project-link"
                                className="grid h-8 w-8 place-items-center rounded-md text-[#51475d] transition hover:bg-[#f1fbf7] hover:text-[#1f7f64] focus:outline-none focus:ring-2 focus:ring-[#9bd8c6]"
                              >
                                <ExternalLink size={15} />
                              </Link>
                              <button
                                type="button"
                                onClick={() => downloadProjectJson(project)}
                                aria-label={`Export ${project.title} as JSON`}
                                data-project-id={project.id}
                                data-testid="export-project-json-button"
                                className="grid h-8 w-8 place-items-center rounded-md text-[#51475d] transition hover:bg-[#f7f3fb] hover:text-[#6b4ea0] focus:outline-none focus:ring-2 focus:ring-[#d9caef]"
                              >
                                <Download size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProject(project.id, project.title)}
                                aria-label={`Delete ${project.title}`}
                                data-project-id={project.id}
                                data-testid="delete-project-button"
                                className="grid h-8 w-8 place-items-center rounded-md text-[#51475d] transition hover:bg-[#fff0ef] hover:text-[#9a413d] focus:outline-none focus:ring-2 focus:ring-[#ffd1cf]"
                              >
                                <Trash2 size={15} />
                              </button>
                              <button
                                type="button"
                                disabled
                                aria-label={`More actions for ${project.title}`}
                                className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-md text-[#756b80] opacity-70"
                              >
                                <MoreHorizontal size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-[#ebe7f1] px-4 py-3 text-center text-xs font-semibold text-[#6f6678]">
                Showing 1-{visibleProjects.length} of {projects.length} projects
              </p>
            </div>
          )}
        </div>
      </div>

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#201a2d]/20 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsCreateOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-dialog-title"
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[#e5e1ec] bg-white shadow-[0_24px_80px_rgba(47,39,67,0.2)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[#ebe7f1] px-4 py-3">
              <div>
                <h2
                  id="new-project-dialog-title"
                  className="text-base font-extrabold text-[#201a2d]"
                >
                  New Project
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-[#756b80]">
                  Start with a research question.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Close new project dialog"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#5f556b] transition hover:bg-[#f5f2f8] focus:outline-none focus:ring-2 focus:ring-[#b9a5db]/40"
              >
                <X size={17} />
              </button>
            </header>
            <div
              aria-label="Create project"
              data-testid="create-project-section"
              className="p-4"
            >
              <ProjectLauncher compact />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
