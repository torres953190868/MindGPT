import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import type { Project } from "@/lib/types";

type BranchMindDataFile = {
  version: 1;
  projects: Project[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "branchmind-projects.json");
let writeQueue: Promise<unknown> = Promise.resolve();

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    notes:
      typeof (project as { notes?: unknown }).notes === "string"
        ? (project as { notes: string }).notes
        : "",
  };
}

function normalizeDataFile(value: unknown): BranchMindDataFile {
  if (
    value &&
    typeof value === "object" &&
    "projects" in value &&
    Array.isArray((value as { projects: unknown }).projects)
  ) {
    return {
      version: 1,
      projects: (value as { projects: Project[] }).projects.map(normalizeProject),
    };
  }

  return { version: 1, projects: [] };
}

export async function readProjects() {
  try {
    const content = await readFile(DATA_FILE, "utf8");
    return normalizeDataFile(JSON.parse(content)).projects;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProjectsNow(projects: Project[]) {
  await mkdir(DATA_DIR, { recursive: true });

  const payload: BranchMindDataFile = { version: 1, projects };
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;

  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, DATA_FILE);
}

function enqueueWrite<T>(operation: () => Promise<T>) {
  const nextWrite = writeQueue.then(operation, operation);
  writeQueue = nextWrite.catch(() => undefined);
  return nextWrite;
}

export async function writeProjects(projects: Project[]) {
  return enqueueWrite(() => writeProjectsNow(projects));
}

export async function updateProjects(
  updater: (projects: Project[]) => Project[] | Promise<Project[]>,
) {
  return enqueueWrite(async () => {
    const projects = await readProjects();
    const nextProjects = await updater(projects);
    await writeProjectsNow(nextProjects);
    return nextProjects;
  });
}

export function projectBelongsToSession(project: Project, sessionId: string) {
  return project.ownerSessionId === sessionId;
}

export function withProjectOwner(project: Project, sessionId: string): Project {
  return {
    ...project,
    ownerSessionId: sessionId,
  };
}

export function getProjectsForSession(projects: Project[], sessionId: string) {
  return projects.filter((project) => projectBelongsToSession(project, sessionId));
}

export async function readProjectsForSession(sessionId: string) {
  return getProjectsForSession(await readProjects(), sessionId);
}
