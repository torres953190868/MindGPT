import type { Project } from "@/lib/types";

type BranchMindProjectExport = {
  schemaVersion: 1;
  product: "BranchMind";
  exportedAt: string;
  project: Project;
};

type ImportProjectsResponse = {
  projects: Project[];
  importedCount: number;
};

export type ProjectImportResult = ImportProjectsResponse & {
  sourceCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isImportableProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.rootNodeId === "string" &&
    isRecord(value.nodes) &&
    isRecord(value.nodes[value.rootNodeId])
  );
}

function getImportableProjects(value: unknown): Project[] {
  if (Array.isArray(value)) return value.filter(isImportableProject);
  if (!isRecord(value)) return [];

  if (isImportableProject(value.project)) return [value.project];
  if (Array.isArray(value.projects)) return value.projects.filter(isImportableProject);
  if (isImportableProject(value)) return [value];

  return [];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Import failed.";
}

async function readImportResponse(response: Response): Promise<ImportProjectsResponse> {
  const data = (await response.json().catch(() => null)) as
    | {
        projects?: unknown;
        importedCount?: unknown;
        error?: string | { message?: string };
      }
    | null;

  if (!response.ok) {
    throw new Error(readApiError(data) ?? "Import failed.");
  }

  const projects = Array.isArray(data?.projects)
    ? data.projects.filter(isImportableProject)
    : [];
  const importedCount =
    typeof data?.importedCount === "number" ? data.importedCount : 0;

  if (!projects.length && importedCount > 0) {
    throw new Error("The server did not return imported projects.");
  }

  return { projects, importedCount };
}

function readApiError(data: { error?: string | { message?: string } } | null) {
  if (typeof data?.error === "string") return data.error;
  if (data?.error && typeof data.error.message === "string") {
    return data.error.message;
  }

  return null;
}

function toSafeFilename(value: string) {
  const safeTitle = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return safeTitle || "project";
}

function toExportableProject(project: Project): Project {
  const exportedProject = { ...project };
  delete exportedProject.ownerSessionId;
  return exportedProject;
}

export function createProjectExport(project: Project): BranchMindProjectExport {
  return {
    schemaVersion: 1,
    product: "BranchMind",
    exportedAt: new Date().toISOString(),
    project: toExportableProject(project),
  };
}

export function downloadProjectJson(project: Project) {
  if (typeof window === "undefined") return;

  const payload = JSON.stringify(createProjectExport(project), null, 2);
  const blob = new Blob([`${payload}\n`], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `branchmind-${toSafeFilename(project.title)}-${project.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export async function importProjectJsonFile(file: File): Promise<ProjectImportResult> {
  try {
    const content = await file.text();
    const payload = JSON.parse(content) as unknown;
    const projects = getImportableProjects(payload);

    if (!projects.length) {
      throw new Error("Choose a BranchMind project JSON export.");
    }

    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projects }),
    });
    const result = await readImportResponse(response);

    return {
      ...result,
      sourceCount: projects.length,
    };
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
