"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Search, Trash2, Upload } from "lucide-react";
import { downloadProjectJson, importProjectJsonFile } from "@/lib/project-export";
import { useBranchMindStore } from "@/store/useBranchMindStore";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Import failed.";
}

export function ProjectCardList() {
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const hydrated = useBranchMindStore((state) => state.hydrated);
  const projects = useBranchMindStore((state) => state.projects);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const deleteProject = useBranchMindStore((state) => state.deleteProject);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(normalized));
  }, [projects, query]);

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
      className="space-y-5"
      aria-labelledby="project-list-title"
      data-testid="project-card-list"
    >
      <h2 id="project-list-title" className="sr-only">
        Project list
      </h2>

      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        data-testid="project-list-toolbar"
      >
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6f6477]" size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            data-testid="project-search-input"
            className="h-12 w-full rounded-[20px] border border-white/80 bg-white/80 pl-11 pr-4 text-[#332b38] outline-none transition placeholder:text-[#6f6477] focus:border-[#a98cc9] focus:ring-4 focus:ring-[#eadcf6]"
          />
        </div>

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
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          disabled={isImporting}
          aria-label="Import BranchMind JSON project"
          data-testid="project-import-json-button"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[20px] bg-[#f1e8fb] px-4 text-sm font-black text-[#5d427d] shadow-sm transition hover:bg-[#e4d5f6] disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Upload size={17} />
          {isImporting ? "Importing..." : "Import JSON"}
        </button>
      </div>

      {importStatus && (
        <p
          role="status"
          data-testid="project-import-status"
          className="rounded-[18px] bg-[#e5f6ee] px-4 py-3 text-sm font-bold text-[#315f47]"
        >
          {importStatus}
        </p>
      )}
      {importError && (
        <p
          role="alert"
          data-testid="project-import-error-alert"
          className="rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          {importError}
        </p>
      )}
      {aiError && (
        <p
          role="alert"
          data-testid="project-list-error-alert"
          className="rounded-[18px] bg-[#ffeceb] px-4 py-3 text-sm font-bold text-[#8f3f3a]"
        >
          {aiError}
        </p>
      )}

      {!hydrated ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="project-list-loading-state"
          className="rounded-[24px] border border-white/80 bg-white/72 p-6 text-center text-sm font-black text-[#5c5065]"
        >
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <section
          aria-label="No projects"
          data-testid="project-empty-state"
          className="rounded-[24px] border border-white/80 bg-white/72 p-6 text-center"
        >
          <h3 className="text-lg font-black text-[#382f41]">No projects yet</h3>
          <p className="mt-2 text-sm font-semibold text-[#665a70]">
            Create a project above or import a BranchMind JSON export.
          </p>
        </section>
      ) : visibleProjects.length === 0 ? (
        <section
          aria-label="No matching projects"
          data-testid="project-search-empty-state"
          className="rounded-[24px] border border-white/80 bg-white/72 p-6 text-center"
        >
          <h3 className="text-lg font-black text-[#382f41]">No matching projects</h3>
          <p className="mt-2 text-sm font-semibold text-[#665a70]">
            Try a different project title.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="project-grid">
          {visibleProjects.map((project) => {
          const nodeCount = Object.keys(project.nodes).length;
          return (
            <article
              key={project.id}
              aria-labelledby={`project-${project.id}-title`}
              data-project-id={project.id}
              data-testid="project-card"
              className="rounded-[24px] border border-white/80 bg-white/82 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-[#dbc9ec]/35"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2
                    id={`project-${project.id}-title`}
                    className="line-clamp-2 text-lg font-extrabold text-[#382f41]"
                  >
                    {project.title}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-[#7c7184]">
                    {nodeCount} nodes
                  </p>
                </div>
                <div
                  className="flex shrink-0 items-center gap-2"
                  role="group"
                  aria-label={`${project.title} actions`}
                >
                  <button
                    type="button"
                    onClick={() => downloadProjectJson(project)}
                    aria-label={`Export ${project.title} as JSON`}
                    data-project-id={project.id}
                    data-testid="export-project-json-button"
                    className="grid h-10 w-10 place-items-center rounded-full bg-[#e5f6ee] text-[#3d7558] transition hover:bg-[#d5efdf]"
                  >
                    <Download size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProject(project.id, project.title)}
                    aria-label={`Delete ${project.title}`}
                    data-project-id={project.id}
                    data-testid="delete-project-button"
                    className="grid h-10 w-10 place-items-center rounded-full bg-[#ffe9ef] text-[#b85b73] transition hover:bg-[#ffd5df]"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <Link
                href={`/workspace/${project.id}`}
                aria-label={`Open ${project.title}`}
                data-project-id={project.id}
                data-testid="open-project-link"
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-[18px] bg-[#dff5ea] font-bold text-[#386b52] transition hover:bg-[#cef0de]"
              >
                Open
              </Link>
            </article>
          );
          })}
        </div>
      )}
    </section>
  );
}
