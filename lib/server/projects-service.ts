import { getContextTitles } from "@/lib/graph";
import {
  createRootProject,
  addChildNode,
  regenerateNode,
  removeNode,
  setNodeCollapsed,
  setProjectNotes,
  updateNodePosition,
} from "@/lib/server/project-model";
import { prepareProjectImport } from "@/lib/server/project-import";
import {
  getProjectsRepository,
  projectBelongsToSession,
  toProjectDto,
  toProjectDtos,
  withProjectOwner,
  type ProjectDto,
} from "@/lib/server/projects-repository";
import type {
  BranchType,
  ChatAttachment,
  ChatMessage,
  MockReply,
  NodePosition,
  Project,
} from "@/lib/types";
import { HttpError } from "./http";

type NodeUpdate = {
  position?: NodePosition;
  collapsed?: boolean;
};

type RegenerateNodeUpdate = {
  reply: MockReply;
  instruction?: string;
  userMessageId?: string;
  assistantMessageId?: string;
};

type PrepareRegenerateNodeUpdate = Omit<RegenerateNodeUpdate, "reply">;

type ProjectUpdate = {
  notes?: string;
};

function notFound(): never {
  throw new HttpError("Resource not found.", {
    code: "NOT_FOUND",
    expose: true,
    status: 404,
  });
}

function badRequest(message: string, code: string): never {
  throw new HttpError(message, {
    code,
    expose: true,
    status: 400,
  });
}

async function readOwnedProject(ownerId: string, projectId: string) {
  const project = (await getProjectsRepository().readProjects()).find(
    (item) => item.id === projectId && projectBelongsToSession(item, ownerId),
  );

  return project ?? null;
}

function getContextSummaries(project: Project, nodeId: string) {
  return getContextTitles(project, nodeId).map((title) => {
    const node = Object.values(project.nodes).find((item) => item.title === title);
    return node ? `${node.title}: ${node.summary}` : title;
  });
}

function findLastAssistantMessage(node: Project["nodes"][string]) {
  for (let index = node.messages.length - 1; index >= 0; index -= 1) {
    const message = node.messages[index];
    if (message.role === "assistant") return message;
  }

  return null;
}

function resolveRegenerateInstruction(
  node: Project["nodes"][string],
  update: PrepareRegenerateNodeUpdate,
) {
  if (typeof update.instruction === "string") return update.instruction.trim();

  const message = findRegenerateUserMessage(node, update);

  if (!message || message.role !== "user") {
    badRequest("User message was not found.", "USER_MESSAGE_NOT_FOUND");
  }

  return message.content.trim();
}

function assertRegenerateTargets(
  node: Project["nodes"][string],
  update: PrepareRegenerateNodeUpdate,
) {
  if (update.userMessageId) {
    const userMessage = node.messages.find((message) => message.id === update.userMessageId);
    if (!userMessage || userMessage.role !== "user") {
      badRequest("User message was not found.", "USER_MESSAGE_NOT_FOUND");
    }
  }

  const assistantMessage = update.assistantMessageId
    ? node.messages.find((message) => message.id === update.assistantMessageId)
    : findLastAssistantMessage(node);

  if (!assistantMessage || assistantMessage.role !== "assistant") {
    badRequest("Assistant message was not found.", "ASSISTANT_MESSAGE_NOT_FOUND");
  }
}

function findRegenerateUserMessage(
  node: Project["nodes"][string],
  update: PrepareRegenerateNodeUpdate,
): ChatMessage | null {
  if (update.userMessageId) {
    return (
      node.messages.find(
        (message) => message.id === update.userMessageId && message.role === "user",
      ) ?? null
    );
  }

  if (update.assistantMessageId) {
    const assistantIndex = node.messages.findIndex(
      (message) => message.id === update.assistantMessageId && message.role === "assistant",
    );

    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      const message = node.messages[index];
      if (message.role === "user") return message;
    }
  }

  return node.messages.find((message) => message.role === "user") ?? null;
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

export async function updateProjectForOwner(
  ownerId: string,
  projectId: string,
  update: ProjectUpdate,
) {
  const project = await readOwnedProject(ownerId, projectId);
  if (!project) notFound();

  let nextProject: Project | null = project;
  if (typeof update.notes === "string") {
    nextProject = setProjectNotes(nextProject, update.notes);
  }

  if (nextProject === project) {
    throw new HttpError("No supported project updates provided.", {
      code: "NO_SUPPORTED_UPDATES",
      expose: true,
      status: 400,
    });
  }

  const ownedProject = withProjectOwner(nextProject, ownerId);
  await getProjectsRepository().saveProject(ownedProject);
  return toProjectDto(ownedProject);
}

export async function createChildNodeForOwner(
  ownerId: string,
  projectId: string,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  instruction: string,
  reply: MockReply,
  attachments: ChatAttachment[] = [],
) {
  const project = await readOwnedProject(ownerId, projectId);
  const parent = project?.nodes[parentId];
  if (!project || !parent) notFound();

  const result = addChildNode(project, parentId, mode, instruction, reply, attachments);
  if (!result) notFound();

  const nextProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(nextProject);

  return {
    project: toProjectDto(nextProject),
    node: result.node,
  };
}

export async function regenerateNodeForOwner(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: RegenerateNodeUpdate,
) {
  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  const result = regenerateNode(project, nodeId, update);
  if (!result) {
    badRequest("Node message could not be regenerated.", "NODE_REGENERATION_FAILED");
  }

  const ownedProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(ownedProject);

  return {
    project: toProjectDto(ownedProject),
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
    contextSummaries: getContextSummaries(project, parentId),
  };
}

export async function prepareRegenerateNodeContext(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: PrepareRegenerateNodeUpdate,
) {
  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  assertRegenerateTargets(node, update);
  const instruction = resolveRegenerateInstruction(node, update);
  if (!instruction) {
    badRequest("User instruction is required.", "USER_INSTRUCTION_REQUIRED");
  }

  const parent = node.parentId ? project.nodes[node.parentId] : null;
  const userMessage = findRegenerateUserMessage(node, update);

  return {
    node,
    instruction,
    attachments: userMessage?.attachments ?? [],
    mode: node.branchType,
    contextSummaries: parent ? getContextSummaries(project, parent.id) : [],
    messages: parent?.messages ?? [],
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
