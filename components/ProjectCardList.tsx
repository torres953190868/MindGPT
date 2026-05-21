"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Brain,
  ChevronDown,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  HelpCircle,
  Home,
  LayoutTemplate,
  Loader2,
  Pencil,
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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [editingProject, setEditingProject] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isSavingProjectName, setIsSavingProjectName] = useState(false);
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const hydrate = useBranchMindStore((state) => state.hydrate);
  const hydrated = useBranchMindStore((state) => state.hydrated);
  const projects = useBranchMindStore((state) => state.projects);
  const aiError = useBranchMindStore((state) => state.aiError);
  const clearAiError = useBranchMindStore((state) => state.clearAiError);
  const deleteProject = useBranchMindStore((state) => state.deleteProject);
  const updateProjectTitle = useBranchMindStore((state) => state.updateProjectTitle);
  const editingProjectId = editingProject?.id ?? null;
  const [starredProjectIds, setStarredProjectIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("branchmind-starred-projects");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "branchmind-starred-projects",
        JSON.stringify(Array.from(starredProjectIds)),
      );
    } catch {
      /* ignore */
    }
  }, [starredProjectIds]);

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
    if (!projectPendingDeletion) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingProject) {
        setProjectPendingDeletion(null);
      }
    }

    deleteCancelButtonRef.current?.focus();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDeletingProject, projectPendingDeletion]);

  useEffect(() => {
    if (!editingProjectId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingProjectId]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(normalized));
  }, [projects, query]);

  function openImportPicker() {
    importInputRef.current?.click();
  }

  function closeDeleteDialog() {
    if (isDeletingProject) return;
    setProjectPendingDeletion(null);
  }

  function startEditingProject(
    event: ReactMouseEvent<HTMLButtonElement>,
    projectId: string,
    projectTitle: string,
  ) {
    event.stopPropagation();
    if (isSavingProjectName) return;
    clearAiError();
    setEditingProject({ id: projectId, title: projectTitle });
  }

  function cancelEditingProject() {
    if (isSavingProjectName) return;
    setEditingProject(null);
  }

  async function saveProjectName(projectId: string, currentTitle: string) {
    if (!editingProject || editingProject.id !== projectId || isSavingProjectName) {
      return;
    }

    const nextTitle = editingProject.title.trim();
    if (!nextTitle) return;
    if (nextTitle === currentTitle) {
      setEditingProject(null);
      return;
    }

    setIsSavingProjectName(true);
    try {
      const saved = await updateProjectTitle(projectId, nextTitle);
      if (saved) setEditingProject(null);
    } finally {
      setIsSavingProjectName(false);
    }
  }

  function handleProjectNameFormSubmit(
    event: FormEvent<HTMLFormElement>,
    projectId: string,
    currentTitle: string,
  ) {
    event.preventDefault();
    void saveProjectName(projectId, currentTitle);
  }

  function handleProjectNameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingProject();
    }
  }

  function handleDeleteProject(
    event: ReactMouseEvent<HTMLButtonElement>,
    projectId: string,
    projectTitle: string,
  ) {
    event.stopPropagation();
    setProjectPendingDeletion({ id: projectId, title: projectTitle });
  }

  async function confirmDeleteProject() {
    if (!projectPendingDeletion || isDeletingProject) return;

    setIsDeletingProject(true);
    try {
      await deleteProject(projectPendingDeletion.id);
      setProjectPendingDeletion(null);
    } finally {
      setIsDeletingProject(false);
    }
  }

  function openProject(projectId: string) {
    router.push(`/workspace/${projectId}`);
  }

  function toggleStar(event: ReactMouseEvent, projectId: string) {
    event.stopPropagation();
    setStarredProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function openNewProjectDraft() {
    router.push("/");
  }

  function handleProjectRowClick(
    event: ReactMouseEvent<HTMLTableRowElement>,
    projectId: string,
  ) {
    if (editingProjectId === projectId) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-project-row-action='true']")
    ) {
      return;
    }

    openProject(projectId);
  }

  function handleProjectRowKeyDown(
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    projectId: string,
  ) {
    if (event.key !== "Enter") return;
    if (editingProjectId === projectId) return;
    if (
      event.target instanceof Element &&
      event.target.closest("[data-project-row-action='true']")
    ) {
      return;
    }

    openProject(projectId);
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
      className="mx-auto flex w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white/95 shadow-xl shadow-[rgba(44,35,62,0.08)] md:min-h-[calc(100vh-2rem)] md:flex-row"
      aria-labelledby="projects-title"
      data-testid="project-card-list"
    >
      {projectPendingDeletion && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#241d30]/45 px-4 py-6 backdrop-blur-sm"
          data-testid="delete-project-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-dialog-title"
            aria-describedby="delete-project-dialog-description"
            data-testid="delete-project-dialog"
            className="w-full max-w-md rounded-xl border border-danger-200 bg-white p-5 text-left shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-danger-50 text-danger-500">
                <Trash2 size={19} />
              </span>
              <div className="min-w-0">
                <h2
                  id="delete-project-dialog-title"
                  className="text-lg font-extrabold text-neutral-900"
                >
                  Delete project?
                </h2>
                <p
                  id="delete-project-dialog-description"
                  className="mt-2 text-sm font-semibold leading-6 text-neutral-700"
                >
                  This permanently removes &quot;{projectPendingDeletion.title}&quot;
                  from BranchMind. Export JSON first if you need a copy.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={deleteCancelButtonRef}
                type="button"
                onClick={closeDeleteDialog}
                disabled={isDeletingProject}
                data-testid="cancel-delete-project-button"
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-extrabold text-neutral-700 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProject}
                disabled={isDeletingProject}
                data-testid="confirm-delete-project-button"
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-danger-500 px-4 text-sm font-extrabold text-white transition hover:bg-danger-600 focus:outline-none focus:ring-2 focus:ring-danger-200 disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isDeletingProject ? "Deleting..." : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}

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

      <aside className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-white px-3 py-3 md:w-56 md:border-b-0 md:border-r">
        <Link
          href="/"
          aria-label="BranchMind home"
          className="flex min-h-11 items-center gap-2 rounded-md px-2 text-neutral-900 transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md border border-brand-200 bg-brand-50 text-brand-600">
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
            className="relative inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-50 px-3 text-brand-700 transition hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500" />
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
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-neutral-800 transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-200/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload size={16} />
            Import
          </button>

          <div className="my-3 border-t border-neutral-200" />

          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-neutral-600 opacity-60"
          >
            <Settings size={16} />
            Settings
          </button>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-md px-3 text-neutral-600 opacity-60"
          >
            <HelpCircle size={16} />
            Help & feedback
          </button>
          <Link
            href="/reader"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-neutral-800 transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
          >
            <FileText size={16} />
            PDF Reader
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-neutral-800 transition hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-200/40"
          >
            <Home size={16} />
            Home
          </Link>
        </nav>

        <div className="mt-5 border-t border-neutral-200 pt-3 md:mt-auto">
          <AuthPanel placement="top" variant="sidebar" className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-success-50 text-success-600">
              <FolderOpen size={18} />
            </span>
            <div className="min-w-0">
              <h1 id="projects-title" className="truncate text-lg font-extrabold text-neutral-900">
                Projects
              </h1>
              <p className="text-xs font-semibold text-neutral-600">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openNewProjectDraft}
            data-testid="open-create-project-dialog-button"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-extrabold text-white shadow-md shadow-brand-200/60 transition hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-200"
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
                className="h-10 w-full rounded-md border border-neutral-200 bg-white pl-9 pr-4 text-sm font-medium text-neutral-900 outline-none transition placeholder:text-neutral-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openImportPicker}
                disabled={isImporting}
                aria-label="Import BranchMind JSON project"
                data-testid="project-import-json-button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-extrabold text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-65"
              >
                <Upload size={16} />
                {isImporting ? "Importing..." : "Import JSON"}
              </button>
              <button
                type="button"
                disabled
                aria-label="Project filter"
                className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-bold text-neutral-600 opacity-60"
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
              className="rounded-md border border-success-200 bg-success-50 px-4 py-3 text-sm font-bold text-success-700"
            >
              {importStatus}
            </p>
          )}
          {importError && (
            <p
              role="alert"
              data-testid="project-import-error-alert"
              className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700"
            >
              {importError}
            </p>
          )}
          {aiError && (
            <p
              role="alert"
              data-testid="project-list-error-alert"
              className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-700"
            >
              {aiError}
            </p>
          )}

          {!hydrated ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="project-list-loading-state"
              className="space-y-0 rounded-lg border border-neutral-200 bg-white"
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-neutral-100 px-4 py-4 last:border-b-0"
                >
                  <div className="h-9 w-9 shrink-0 rounded-full skeleton-shimmer" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-1/3 max-w-[200px] rounded-md skeleton-shimmer" />
                    <div className="h-3 w-16 rounded-md skeleton-shimmer" />
                  </div>
                  <div className="hidden w-28 sm:block">
                    <div className="h-3 w-20 rounded-md skeleton-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <section
              aria-label="No projects"
              data-testid="project-empty-state"
              className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white p-10 text-center"
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                <FolderOpen size={28} />
              </span>
              <h2 className="mt-4 text-lg font-extrabold text-neutral-900">No projects yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-neutral-700">
                Create a project with New Project or import a BranchMind JSON export.
              </p>
              <button
                type="button"
                onClick={openNewProjectDraft}
                className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-sm font-extrabold text-white shadow-md shadow-brand-200/50 transition hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-lg"
              >
                <Plus size={16} />
                New Project
              </button>
            </section>
          ) : visibleProjects.length === 0 ? (
            <section
              aria-label="No matching projects"
              data-testid="project-search-empty-state"
              className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white p-10 text-center"
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100 text-neutral-600">
                <Search size={28} />
              </span>
              <h2 className="mt-4 text-lg font-extrabold text-neutral-900">No matching projects</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-700">
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
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-extrabold uppercase tracking-wide text-neutral-700">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Name
                      </th>
                      <th scope="col" className="w-28 px-4 py-3">
                        Nodes
                      </th>
                      <th scope="col" className="w-48 px-4 py-3">
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
                      const isEditingProject = editingProjectId === project.id;
                      const editedProjectName = isEditingProject && editingProject
                        ? editingProject.title
                        : project.title;

                      return (
                        <tr
                          key={project.id}
                          role="link"
                          tabIndex={0}
                          aria-label={`Open ${project.title}`}
                          onClick={(event) => handleProjectRowClick(event, project.id)}
                          onKeyDown={(event) => handleProjectRowKeyDown(event, project.id)}
                          data-project-id={project.id}
                          data-testid="project-card"
                          className="group cursor-pointer transition hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-300/50"
                        >
                          <td className="px-4 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <button
                                type="button"
                                onClick={(event) => toggleStar(event, project.id)}
                                aria-label={
                                  starredProjectIds.has(project.id)
                                    ? `Unstar ${project.title}`
                                    : `Star ${project.title}`
                                }
                                data-project-row-action="true"
                                className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition hover:bg-neutral-100 ${
                                  starredProjectIds.has(project.id)
                                    ? "text-brand-500"
                                    : "text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                                }`}
                              >
                                <Star
                                  size={15}
                                  fill={
                                    starredProjectIds.has(project.id)
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </button>
                              {isEditingProject ? (
                                <form
                                  onSubmit={(event) =>
                                    handleProjectNameFormSubmit(
                                      event,
                                      project.id,
                                      project.title,
                                    )
                                  }
                                  data-project-row-action="true"
                                  className="flex min-w-0 flex-1 items-center gap-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <input
                                      ref={editInputRef}
                                      value={editedProjectName}
                                      onChange={(event) =>
                                        setEditingProject({
                                          id: project.id,
                                          title: event.target.value,
                                        })
                                      }
                                      onKeyDown={handleProjectNameKeyDown}
                                      disabled={isSavingProjectName}
                                      aria-label={`Project name for ${project.title}`}
                                      data-testid="project-name-edit-input"
                                      className="h-9 w-full rounded-md border border-brand-200 bg-white px-3 text-sm font-extrabold text-neutral-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-neutral-600">
                                      <span className="h-1.5 w-1.5 rounded-full bg-success-400" />
                                      {formatNodeCount(nodeCount)}
                                    </p>
                                  </div>
                                  <button
                                    type="submit"
                                    disabled={!editedProjectName.trim() || isSavingProjectName}
                                    aria-label={`Save project name for ${project.title}`}
                                    data-testid="save-project-name-button"
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-success-600 text-white transition hover:bg-success-700 focus:outline-none focus:ring-2 focus:ring-success-200 disabled:cursor-not-allowed disabled:opacity-45"
                                  >
                                    {isSavingProjectName ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Check size={15} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditingProject}
                                    disabled={isSavingProjectName}
                                    aria-label={`Cancel project name edit for ${project.title}`}
                                    data-testid="cancel-project-name-button"
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-300 bg-white text-neutral-700 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-45"
                                  >
                                    <X size={15} />
                                  </button>
                                </form>
                              ) : (
                                <div className="min-w-0 flex-1">
                                  <h2 className="truncate text-sm font-extrabold text-neutral-900">
                                    {project.title}
                                  </h2>
                                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-neutral-600">
                                    <span className="h-1.5 w-1.5 rounded-full bg-success-400" />
                                    {formatNodeCount(nodeCount)}
                                  </p>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 font-bold text-neutral-800">
                            {nodeCount}
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
                              <Clock3 size={13} className="text-neutral-500" />
                              {formatProjectDate(project.updatedAt)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div
                              className="flex items-center justify-end gap-1"
                              role="group"
                              aria-label={`${project.title} actions`}
                            >
                              <Link
                                href={`/workspace/${project.id}`}
                                aria-label={`Open ${project.title}`}
                                data-project-row-action="true"
                                data-project-id={project.id}
                                data-testid="open-project-link"
                                className="grid h-8 w-8 place-items-center rounded-md text-neutral-700 transition hover:bg-success-50 hover:text-success-700 focus:outline-none focus:ring-2 focus:ring-success-200"
                              >
                                <ExternalLink size={15} />
                              </Link>
                              <button
                                type="button"
                                onClick={() => downloadProjectJson(project)}
                                aria-label={`Export ${project.title} as JSON`}
                                data-project-row-action="true"
                                data-project-id={project.id}
                                data-testid="export-project-json-button"
                                className="grid h-8 w-8 place-items-center rounded-md text-neutral-700 transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
                              >
                                <Download size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) =>
                                  startEditingProject(event, project.id, project.title)
                                }
                                aria-label={`Edit ${project.title} name`}
                                data-project-row-action="true"
                                data-project-id={project.id}
                                data-testid="edit-project-name-button"
                                className="grid h-8 w-8 place-items-center rounded-md text-neutral-700 transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) =>
                                  handleDeleteProject(event, project.id, project.title)
                                }
                                aria-label={`Delete ${project.title}`}
                                data-project-row-action="true"
                                data-project-id={project.id}
                                data-testid="delete-project-button"
                                className="grid h-8 w-8 place-items-center rounded-md text-neutral-700 transition hover:bg-danger-50 hover:text-danger-600 focus:outline-none focus:ring-2 focus:ring-danger-200"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-neutral-200 px-4 py-3 text-center text-xs font-semibold text-neutral-600">
                Showing {visibleProjects.length} of {projects.length} projects
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
