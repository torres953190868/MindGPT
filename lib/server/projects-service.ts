import { getContextTitles, getNodeConversationMessages } from "@/lib/graph";
import {
  getRegenerateConversationPrefix,
  resolveRegenerateTargets,
  type RegenerateTargets,
} from "@/lib/message-regeneration";
import {
  createRootProject,
  createPendingRootProject,
  addBlankChildNode,
  addChildNode,
  appendNodeMessage,
  populateBlankNode,
  regenerateNode,
  removeNode,
  setNodeCollapsed,
  setProjectNotes,
  setProjectTitle,
  updateNodeTitle,
  updateNodePosition,
} from "@/lib/server/project-model";
import { prepareProjectImport, uniquifyImportedProjectTitles } from "@/lib/server/project-import";
import { getBranchMindLanguage, type BranchMindLanguage } from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import {
  getProjectsRepository,
  projectBelongsToSession,
  toProjectDto,
  toProjectDtos,
  withProjectOwner,
  type ProjectDto,
} from "@/lib/server/projects-repository";
import {
  buildContextSummariesFromPath,
  buildContextualizedRetrievalQuery,
  buildTreePromptContext,
  collectInheritedKnowledgeAttachments,
  type UserMemoryContextSlot,
} from "@/lib/server/tree-context";
import type {
  BranchType,
  ChatAttachment,
  MockReply,
  NodePosition,
  Project,
} from "@/lib/types";
import { HttpError } from "./http";

type NodeUpdate = {
  title?: string;
  position?: NodePosition;
  collapsed?: boolean;
};

type RegenerateNodeUpdate = {
  reply: MockReply;
  instruction?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  expectedNodeUpdatedAt?: string;
};

type PrepareRegenerateNodeUpdate = Omit<RegenerateNodeUpdate, "reply"> & {
  hasSourceText?: boolean;
};

export type PrepareChildContextOptions = {
  mode?: Exclude<BranchType, "root">;
  hasSourceText?: boolean;
  userMemory?: UserMemoryContextSlot;
  explicitAttachments?: ChatAttachment[];
  instruction?: string;
  sourceText?: string;
};

type PopulateBlankNodeUpdate = {
  instruction: string;
  attachments?: ChatAttachment[];
};

export type PrepareAppendNodeMessageUpdate = {
  instruction: string;
  sourceText?: string;
  attachments?: ChatAttachment[];
  expectedNodeUpdatedAt?: string;
  userMemory?: UserMemoryContextSlot;
};

export type AppendNodeMessageUpdate = {
  instruction: string;
  reply: MockReply;
  attachments?: ChatAttachment[];
  expectedNodeUpdatedAt?: string;
};

type ProjectUpdate = {
  title?: string;
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
  const repository = getProjectsRepository();
  if (typeof repository.readProjectForOwner === "function") {
    return repository.readProjectForOwner(ownerId, projectId);
  }

  const project = (await repository.readProjects()).find(
    (item) => item.id === projectId && projectBelongsToSession(item, ownerId),
  );

  return project ?? null;
}

function resolveRegenerateInstruction(
  node: Project["nodes"][string],
  update: PrepareRegenerateNodeUpdate,
  targets: RegenerateTargets,
) {
  if (typeof update.instruction === "string") return update.instruction.trim();

  if (targets.userMessage.role !== "user") {
    badRequest("User message was not found.", "USER_MESSAGE_NOT_FOUND");
  }

  return targets.userMessage.content.trim();
}

function getRegenerateTargetsOrBadRequest(
  node: Project["nodes"][string],
  update: PrepareRegenerateNodeUpdate,
) {
  const targets = resolveRegenerateTargets(node.messages, update);
  if (targets) {
    if (!targets.isLatestAssistant) {
      badRequest(
        "Only the latest message in a node can be edited or retried.",
        "REGENERATE_NOT_LATEST",
      );
    }

    return targets;
  }

  if (
    update.userMessageId &&
    !node.messages.some(
      (message) => message.id === update.userMessageId && message.role === "user",
    )
  ) {
    badRequest("User message was not found.", "USER_MESSAGE_NOT_FOUND");
  }

  if (
    update.assistantMessageId &&
    !node.messages.some(
      (message) =>
        message.id === update.assistantMessageId && message.role === "assistant",
    )
  ) {
    badRequest("Assistant message was not found.", "ASSISTANT_MESSAGE_NOT_FOUND");
  }

  if (update.userMessageId && update.assistantMessageId) {
    badRequest(
      "User and assistant messages are not a regeneration pair.",
      "REGENERATE_TARGET_MISMATCH",
    );
  }

  badRequest("Assistant message was not found.", "ASSISTANT_MESSAGE_NOT_FOUND");
}

export async function listProjects(ownerId: string) {
  return getProjectsRepository().readProjectsForSession(ownerId);
}

export async function createProjectForOwner(
  ownerId: string,
  topic: string,
  reply: MockReply,
  attachments: ChatAttachment[] = [],
) {
  const project = withProjectOwner(createRootProject(topic, reply, attachments), ownerId);
  await getProjectsRepository().saveProject(project);

  return {
    project: toProjectDto(project),
    projects: await listProjects(ownerId),
  };
}

export async function createPendingProjectForOwner(
  ownerId: string,
  topic: string,
  attachments: ChatAttachment[] = [],
) {
  const result = createPendingRootProject(topic, attachments);
  const project = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(project);

  return {
    project: toProjectDto(project),
    projects: await listProjects(ownerId),
    initialStream: {
      nodeId: result.node.id,
      assistantMessageId: result.assistantMessageId,
    },
  };
}

function assertSyncProjectGraph(projectId: string, project: Project) {
  if (project.id !== projectId) {
    throw new HttpError("Project ID does not match the sync route.", {
      code: "PROJECT_ID_MISMATCH",
      expose: true,
      status: 400,
    });
  }

  const rootNode = project.nodes[project.rootNodeId];
  if (!rootNode) {
    throw new HttpError("Project is missing its root node.", {
      code: "PROJECT_ROOT_MISSING",
      expose: true,
      status: 400,
    });
  }

  if (rootNode.parentId !== null || rootNode.branchType !== "root") {
    throw new HttpError("Project root node is invalid.", {
      code: "PROJECT_ROOT_INVALID",
      expose: true,
      status: 400,
    });
  }

  for (const [nodeId, node] of Object.entries(project.nodes)) {
    if (node.id !== nodeId || node.projectId !== project.id) {
      throw new HttpError("Project node IDs are invalid.", {
        code: "PROJECT_NODE_INVALID",
        expose: true,
        status: 400,
      });
    }

    if (node.parentId && !project.nodes[node.parentId]) {
      throw new HttpError("Project node parent is invalid.", {
        code: "PROJECT_NODE_PARENT_INVALID",
        expose: true,
        status: 400,
      });
    }

    for (const childId of node.children) {
      const child = project.nodes[childId];
      if (!child || child.parentId !== node.id) {
        throw new HttpError("Project node children are invalid.", {
          code: "PROJECT_NODE_CHILD_INVALID",
          expose: true,
          status: 400,
        });
      }
    }

    if (node.messages.length === 0) {
      throw new HttpError("Project node messages are missing.", {
        code: "PROJECT_NODE_MESSAGES_MISSING",
        expose: true,
        status: 400,
      });
    }
  }
}

export async function syncProjectForOwner(
  ownerId: string,
  projectId: string,
  project: Project,
) {
  assertSyncProjectGraph(projectId, project);

  const repository = getProjectsRepository();
  const existingOwnerId =
    typeof repository.readProjectOwnerId === "function"
      ? await repository.readProjectOwnerId(projectId)
      : ((await repository.readProjects()).find((item) => item.id === projectId)
          ?.ownerSessionId ?? null);

  if (existingOwnerId && existingOwnerId !== ownerId) {
    throw new HttpError("Project belongs to another owner.", {
      code: "PROJECT_OWNER_MISMATCH",
      expose: true,
      status: 403,
    });
  }

  const ownedProject = withProjectOwner(
    {
      ...project,
      ownerSessionId: undefined,
    },
    ownerId,
  );

  await repository.saveProject(ownedProject);
  return toProjectDto(ownedProject);
}

export async function deleteProjectForOwner(ownerId: string, projectId: string) {
  const project = await readOwnedProject(ownerId, projectId);

  if (project) {
    await getProjectsRepository().deleteProject(projectId);
  }

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
  if (typeof update.title === "string") {
    nextProject = setProjectTitle(nextProject, update.title);
    if (!nextProject) {
      badRequest("Project title is required.", "PROJECT_TITLE_REQUIRED");
    }
  }

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

export async function createBlankChildNodeForOwner(
  ownerId: string,
  projectId: string,
  parentId: string,
  mode: Exclude<BranchType, "root">,
  nodeId?: string,
) {
  const project = await readOwnedProject(ownerId, projectId);
  const parent = project?.nodes[parentId];
  if (!project || !parent) notFound();

  const result = addBlankChildNode(project, parentId, mode, nodeId);
  if (!result) {
    badRequest("Blank node could not be created.", "BLANK_NODE_CREATE_FAILED");
  }

  const nextProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(nextProject);

  return {
    project: toProjectDto(nextProject),
    node: result.node,
  };
}

export async function preparePopulateBlankNodeContext(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: PopulateBlankNodeUpdate,
) {
  const instruction = update.instruction.trim();
  if (!instruction) badRequest("Instruction is required.", "INSTRUCTION_REQUIRED");

  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  if (node.messages.length > 0) {
    badRequest("Node already has messages.", "NODE_ALREADY_POPULATED");
  }

  const attachments = update.attachments ?? [];
  const contextNodeId = node.parentId ?? nodeId;
  const treeContext = buildTreePromptContext({
    project,
    ancestorNodeId: node.parentId,
    mode: node.branchType,
    excludeNodeId: node.id,
  });
  const inheritedAttachments = collectInheritedKnowledgeAttachments({
    project,
    ancestorNodeId: node.parentId,
    explicitAttachments: attachments,
  });
  const retrievalQuery = buildContextualizedRetrievalQuery({
    project,
    ancestorNodeId: node.parentId,
    instruction,
  });

  return {
    attachments,
    inheritedAttachments,
    retrievalQuery,
    contextSummaries: buildContextSummariesFromPath(project, contextNodeId),
    instruction,
    messages: node.parentId
      ? getNodeConversationMessages(project, node.parentId).map((item) => item.message)
      : [],
    mode: node.branchType,
    treeContext,
  };
}

export async function populateBlankNodeForOwner(
  ownerId: string,
  projectId: string,
  nodeId: string,
  instruction: string,
  reply: MockReply,
  attachments: ChatAttachment[] = [],
) {
  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  const result = populateBlankNode(project, nodeId, instruction, reply, attachments);
  if (!result) {
    badRequest("Blank node could not be populated.", "BLANK_NODE_POPULATE_FAILED");
  }

  const ownedProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(ownedProject);

  return {
    project: toProjectDto(ownedProject),
    node: result.node,
  };
}

function isSameTimestamp(left: string, right: string) {
  if (left === right) return true;

  // Timestamps may arrive in different ISO 8601 variants (e.g. a client-held
  // value from an in-memory DTO vs. a database round-trip). Compare the
  // instants they represent instead of the raw strings.
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return !Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs === rightMs;
}

export async function prepareAppendNodeMessageContext(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: PrepareAppendNodeMessageUpdate,
) {
  const instruction = update.instruction.trim();
  if (!instruction) badRequest("Instruction is required.", "INSTRUCTION_REQUIRED");

  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  if (node.messages.length === 0) {
    badRequest("Blank node must be populated first.", "NODE_IS_BLANK");
  }

  if (
    update.expectedNodeUpdatedAt &&
    !isSameTimestamp(node.updatedAt, update.expectedNodeUpdatedAt)
  ) {
    throw new HttpError(
      "This conversation was updated in another window. Reload and try again.",
      {
        code: "NODE_CONFLICT",
        expose: true,
        status: 409,
      },
    );
  }

  const parentId = node.parentId;
  const attachments = update.attachments ?? [];
  const hasSourceText = Boolean(update.sourceText?.trim());
  const treeContext = buildTreePromptContext({
    project,
    ancestorNodeId: parentId,
    mode: node.branchType,
    hasSourceText,
    userMemory: update.userMemory,
    excludeNodeId: node.id,
    currentNodePrefixMessages: node.messages,
    currentNode: node,
  });
  const inheritedAttachments = collectInheritedKnowledgeAttachments({
    project,
    ancestorNodeId: parentId,
    explicitAttachments: attachments,
    currentNodePrefixMessages: node.messages,
  });
  const retrievalQuery = buildContextualizedRetrievalQuery({
    project,
    ancestorNodeId: node.id,
    instruction,
    sourceText: update.sourceText,
  });

  return {
    node,
    instruction,
    attachments,
    inheritedAttachments,
    retrievalQuery,
    mode: node.branchType,
    contextSummaries: buildContextSummariesFromPath(project, node.id),
    messages: getNodeConversationMessages(project, node.id).map((item) => item.message),
    treeContext,
  };
}

export async function appendNodeMessageForOwner(
  ownerId: string,
  projectId: string,
  nodeId: string,
  update: AppendNodeMessageUpdate,
) {
  const project = await readOwnedProject(ownerId, projectId);
  const node = project?.nodes[nodeId];
  if (!project || !node) notFound();

  if (node.messages.length === 0) {
    badRequest("Blank node must be populated first.", "NODE_IS_BLANK");
  }

  if (
    update.expectedNodeUpdatedAt &&
    !isSameTimestamp(node.updatedAt, update.expectedNodeUpdatedAt)
  ) {
    throw new HttpError(
      "This conversation was updated in another window. Reload and try again.",
      {
        code: "NODE_CONFLICT",
        expose: true,
        status: 409,
      },
    );
  }

  const result = appendNodeMessage(
    project,
    nodeId,
    update.instruction,
    update.reply,
    update.attachments ?? [],
  );
  if (!result) {
    badRequest("Node message could not be appended.", "NODE_APPEND_FAILED");
  }

  const ownedProject = withProjectOwner(result.project, ownerId);
  await getProjectsRepository().saveProject(ownedProject);

  return {
    project: toProjectDto(ownedProject),
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

  if (
    update.expectedNodeUpdatedAt &&
    !isSameTimestamp(node.updatedAt, update.expectedNodeUpdatedAt)
  ) {
    throw new HttpError(
      "This conversation was updated in another window. Reload and try again.",
      {
        code: "NODE_CONFLICT",
        expose: true,
        status: 409,
      },
    );
  }

  getRegenerateTargetsOrBadRequest(node, update);
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
  if (
    update.position &&
    typeof update.title !== "string" &&
    typeof update.collapsed !== "boolean"
  ) {
    const project = await getProjectsRepository().updateNodePositionForOwner(
      ownerId,
      projectId,
      nodeId,
      update.position,
    );
    if (!project) notFound();
    return project;
  }

  const project = await readOwnedProject(ownerId, projectId);
  if (!project) notFound();

  let nextProject: Project | null = project;
  if (typeof update.title === "string") {
    nextProject = updateNodeTitle(nextProject, nodeId, update.title);
    if (!nextProject) notFound();
  }

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

export async function prepareChildContext(
  ownerId: string,
  projectId: string,
  parentId: string,
  options: PrepareChildContextOptions = {},
) {
  const project = await readOwnedProject(ownerId, projectId);
  const parent = project?.nodes[parentId];
  if (!project || !parent) notFound();

  const hasSourceText = options.hasSourceText ?? Boolean(options.sourceText?.trim());
  const treeContext = buildTreePromptContext({
    project,
    ancestorNodeId: parentId,
    mode: options.mode ?? "continue",
    hasSourceText,
    userMemory: options.userMemory,
  });
  const inheritedAttachments = collectInheritedKnowledgeAttachments({
    project,
    ancestorNodeId: parentId,
    explicitAttachments: options.explicitAttachments,
  });
  const retrievalQuery =
    typeof options.instruction === "string"
      ? buildContextualizedRetrievalQuery({
          project,
          ancestorNodeId: parentId,
          instruction: options.instruction,
          sourceText: options.sourceText,
        })
      : undefined;

  return {
    parent,
    contextTitles: getContextTitles(project, parentId),
    contextSummaries: buildContextSummariesFromPath(project, parentId),
    messages: getNodeConversationMessages(project, parentId).map((item) => item.message),
    treeContext,
    inheritedAttachments,
    ...(retrievalQuery !== undefined ? { retrievalQuery } : {}),
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

  const targets = getRegenerateTargetsOrBadRequest(node, update);
  const instruction = resolveRegenerateInstruction(node, update, targets);
  if (!instruction) {
    badRequest("User instruction is required.", "USER_INSTRUCTION_REQUIRED");
  }

  const parentId = node.parentId;
  const ancestorMessages = parentId
    ? getNodeConversationMessages(project, parentId).map((item) => item.message)
    : [];
  const currentMessages = getRegenerateConversationPrefix(
    node.messages,
    targets,
  );
  const treeContext = buildTreePromptContext({
    project,
    ancestorNodeId: parentId,
    mode: node.branchType,
    hasSourceText: update.hasSourceText,
    excludeNodeId: node.id,
    currentNodePrefixMessages: currentMessages,
    currentNode: node,
  });
  const explicitAttachments = targets.userMessage.attachments;
  const inheritedAttachments = collectInheritedKnowledgeAttachments({
    project,
    ancestorNodeId: parentId,
    explicitAttachments,
    currentNodePrefixMessages: currentMessages,
  });
  const retrievalQuery = buildContextualizedRetrievalQuery({
    project,
    ancestorNodeId: parentId,
    instruction,
  });

  return {
    node,
    instruction,
    attachments: explicitAttachments,
    inheritedAttachments,
    retrievalQuery,
    mode: node.branchType,
    contextSummaries: parentId ? buildContextSummariesFromPath(project, parentId) : [],
    messages: [...ancestorMessages, ...currentMessages],
    treeContext,
  };
}

export async function importProjectsForOwner(
  ownerId: string,
  payload: unknown,
  options: { language?: BranchMindLanguage } = {},
) {
  const result = prepareProjectImport(payload, { ownerSessionId: ownerId });
  if (result.projects.length === 0) {
    throw new HttpError("Choose a BranchMind project JSON export.", {
      code: "NO_IMPORTABLE_PROJECTS",
      expose: true,
      status: 400,
    });
  }

  const { copySuffix } = LANGUAGE_COPY[getBranchMindLanguage(options.language)].projects;
  const existingTitles = (await listProjects(ownerId)).map((project) => project.title);
  const projects = uniquifyImportedProjectTitles(result.projects, existingTitles, copySuffix);

  for (const project of projects) {
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
