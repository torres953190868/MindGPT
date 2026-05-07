import { getContextTitles } from "@/lib/graph";
import { createRootProject, addChildNode, removeNode, setNodeCollapsed, updateNodePosition } from "@/lib/server/project-model";
import { prepareProjectImport } from "@/lib/server/project-import";
import {
  getProjectsRepository,
  projectBelongsToSession,
  toProjectDto,
  toProjectDtos,
  withProjectOwner,
  type ProjectDto,
} from "@/lib/server/projects-repository";
import type { BranchType, MockReply, NodePosition, Project } from "@/lib/types";
import { HttpError } from "./http";

type NodeUpdate = {
  position?: NodePosition;
  collapsed?: boolean;
};

function notFound(): never {
  throw new HttpError("Resource not found.", {
    code: "NOT_FOUND",
    expose: true,
    status: 404,
  });
}

async function readOwnedProject(ownerId: string, projectId: string) {
  const project = (await getProjectsRepository().readProjects()).find(
    (item) => item.id === projectId && projectBelongsToSession(item, ownerId),
  );

  return project ?? null;
}

export async function listProjects(ownerId: string) {
  return getProjectsRepository().readProjectsForSession(ownerId);
}

export async function createProjectForOwner(
  ownerId: string,
  topic: string,
  reply: MockReply,
) {
  const project = withProjectOwner(createRootProject(topic, reply), ownerId);
  await getProjectsRepository().saveProject(project);

  return {
    project: toProjectDto(project),
    projects: await listProjects(ownerId),
  };
}

export async function deleteProjectForOwner(ownerId: string, projectId: string) {
  const project = await readOwnedProject(ownerId, projectId);
  if (!project) notFound();

  await getProjectsRepository().deleteProject(projectId);
  return listProjects(ownerId);
}

export async function createChildNodeForOwner(
  ownerId: string,
  projectId: string,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  instruction: string,
  reply: MockReply,
) {
  const project = await readOwnedProject(ownerId, projectId);
  const parent = project?.nodes[parentId];
  if (!project || !parent) notFound();

  const result = addChildNode(project, parentId, mode, instruction, reply);
  if (!result) notFound();

  const nextProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(nextProject);

  return {
    project: toProjectDto(nextProject),
    node: result.node,
  };
}

export async function updateNodeForOwner(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: NodeUpdate,
) {
  const project = await readOwnedProject(ownerId, projectId);
  if (!project) notFound();

  let nextProject: Project | null = project;
  if (update.position) {
    nextProject = updateNodePosition(nextProject, nodeId, update.position);
    if (!nextProject) notFound();
  }

  if (typeof update.collapsed === "boolean") {
    nextProject = setNodeCollapsed(nextProject, nodeId, update.collapsed);
    if (!nextProject) notFound();
  }

  if (nextProject === project) {
    throw new HttpError("No supported node updates provided.", {
      code: "NO_SUPPORTED_UPDATES",
      expose: true,
      status: 400,
    });
  }

  const ownedProject = withProjectOwner(nextProject, ownerId);
  await getProjectsRepository().saveProject(ownedProject);
  return toProjectDto(ownedProject);
}

export async function deleteNodeForOwner(
  ownerId: string,
  projectId: string,
  nodeId: string,
) {
  const project = await readOwnedProject(ownerId, projectId);
  if (!project) notFound();

  const result = removeNode(project, nodeId);
  if (!result) {
    throw new HttpError("Node cannot be deleted.", {
      code: "NODE_CANNOT_BE_DELETED",
      expose: true,
      status: 400,
    });
  }

  const ownedProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(ownedProject);

  return {
    project: toProjectDto(ownedProject),
    selectedNodeId: result.parentId,
  };
}

export async function prepareChildContext(ownerId: string, projectId: string, parentId: string) {
  const project = await readOwnedProject(ownerId, projectId);
  const parent = project?.nodes[parentId];
  if (!project || !parent) notFound();

  return {
    parent,
    contextTitles: getContextTitles(project, parentId),
    contextSummaries: getContextTitles(project, parentId).map((title) => {
      const node = Object.values(project.nodes).find((item) => item.title === title);
      return node ? `${node.title}: ${node.summary}` : title;
    }),
  };
}

export async function importProjectsForOwner(ownerId: string, payload: unknown) {
  const result = prepareProjectImport(payload, { ownerSessionId: ownerId });
  if (result.projects.length === 0) {
    throw new HttpError("Choose a BranchMind project JSON export.", {
      code: "NO_IMPORTABLE_PROJECTS",
      expose: true,
      status: 400,
    });
  }

  for (const project of result.projects) {
    await getProjectsRepository().saveProject(withProjectOwner(project, ownerId));
  }

  return {
    projects: await listProjects(ownerId),
    importedCount: result.importedCount,
    rejectedCount: result.rejectedCount,
  };
}

export function serializeProject(project: Project): ProjectDto {
  return toProjectDto(project);
}

export function serializeProjects(projects: Project[]): ProjectDto[] {
  return toProjectDtos(projects);
}
