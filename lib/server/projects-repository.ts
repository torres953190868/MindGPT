import { normalizeChatAttachments } from "@/lib/chat-attachments";
import { normalizeChatCitations } from "@/lib/chat-citations";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ChatMessage, MindNode, NodePosition, Project } from "@/lib/types";
import * as fileStore from "./projects-store";

type ProjectRow = Database["public"]["Tables"]["branchmind_projects"]["Row"];
type ProjectInsert = Database["public"]["Tables"]["branchmind_projects"]["Insert"];
type NodeRow = Database["public"]["Tables"]["branchmind_nodes"]["Row"];
type NodeInsert = Database["public"]["Tables"]["branchmind_nodes"]["Insert"];
type MessageRow = Database["public"]["Tables"]["branchmind_messages"]["Row"];
type MessageInsert = Database["public"]["Tables"]["branchmind_messages"]["Insert"];

export type ProjectDto = Omit<Project, "ownerSessionId">;
export type OwnedProject = Project & { ownerSessionId: string };
export type ProjectsBackend = "file" | "supabase";

type SupabaseProjectSchemaCapabilities = {
  messageAttachments: boolean;
  messageCitations: boolean;
  nodeManualTitles: boolean;
  projectNotes: boolean;
};

type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
} | null;

export type ProjectsRepository = {
  backend: ProjectsBackend;
  readProjects: () => Promise<OwnedProject[]>;
  readProjectsForSession: (sessionId: string) => Promise<ProjectDto[]>;
  writeProjects: (projects: Project[]) => Promise<void>;
  updateProjects: (updater: (projects: OwnedProject[]) => Project[] | Promise<Project[]>) => Promise<OwnedProject[]>;
  saveProject: (project: Project) => Promise<void>;
  updateNodePositionForOwner: (
    ownerId: string,
    projectId: string,
    nodeId: string,
    position: NodePosition,
  ) => Promise<ProjectDto | null>;
  deleteProject: (projectId: string) => Promise<void>;
  transferOwner: (fromOwnerId: string, toOwnerId: string) => Promise<number>;
};

function assertNoError(error: { message: string } | null, operation: string) {
  if (!error) return;
  throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function isMissingColumnError(error: SupabaseErrorLike) {
  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");
  return Boolean(
    text &&
      (error?.code === "42703" ||
        error?.code === "PGRST204" ||
        /column .* does not exist|could not find .* column/i.test(text)),
  );
}

function isMissingFunctionError(error: SupabaseErrorLike) {
  const text = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");
  return Boolean(
    text &&
      (error?.code === "42883" ||
        error?.code === "PGRST202" ||
        /function .* does not exist|could not find .* function/i.test(text)),
  );
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

let schemaCapabilitiesPromise:
  | Promise<SupabaseProjectSchemaCapabilities>
  | undefined;

async function getSchemaCapabilities(
  client = getSupabaseAdminClient(),
): Promise<SupabaseProjectSchemaCapabilities> {
  schemaCapabilitiesPromise ??= Promise.all([
    client
      .from("branchmind_projects")
      .select("id,notes")
      .limit(1),
    client
      .from("branchmind_messages")
      .select("id,attachments")
      .limit(1),
    client
      .from("branchmind_messages")
      .select("id,citations")
      .limit(1),
    client
      .from("branchmind_nodes")
      .select("id,title_manually_edited")
      .limit(1),
  ]).then(([projectsResult, messagesResult, citationsResult, nodesResult]) => ({
    projectNotes: !isMissingColumnError(projectsResult.error),
    messageAttachments: !isMissingColumnError(messagesResult.error),
    messageCitations: !isMissingColumnError(citationsResult.error),
    nodeManualTitles: !isMissingColumnError(nodesResult.error),
  }));

  return schemaCapabilitiesPromise;
}

function cacheSchemaCapabilities(capabilities: SupabaseProjectSchemaCapabilities) {
  schemaCapabilitiesPromise = Promise.resolve(capabilities);
}

function getSchemaCapabilitiesAfterMissingColumnError(
  capabilities: SupabaseProjectSchemaCapabilities,
  error: unknown,
) {
  const text = getErrorText(error);
  if (!isMissingColumnError({ message: text })) return null;

  const nextCapabilities = { ...capabilities };
  if (/branchmind_projects|notes/i.test(text)) {
    nextCapabilities.projectNotes = false;
  }
  if (/branchmind_messages|attachments/i.test(text)) {
    nextCapabilities.messageAttachments = false;
  }
  if (/branchmind_messages|citations/i.test(text)) {
    nextCapabilities.messageCitations = false;
  }
  if (/branchmind_nodes|title_manually_edited/i.test(text)) {
    nextCapabilities.nodeManualTitles = false;
  }

  if (
    nextCapabilities.projectNotes === capabilities.projectNotes &&
    nextCapabilities.messageAttachments === capabilities.messageAttachments &&
    nextCapabilities.messageCitations === capabilities.messageCitations &&
    nextCapabilities.nodeManualTitles === capabilities.nodeManualTitles
  ) {
    return null;
  }

  return nextCapabilities;
}

function requireProjectOwner(project: Project) {
  const ownerSessionId = project.ownerSessionId?.trim();
  if (!ownerSessionId) {
    throw new Error(`Project ${project.id} cannot be persisted without ownerSessionId.`);
  }

  return ownerSessionId;
}

export function toProjectDto(project: Project): ProjectDto {
  const clientProject = { ...project };
  delete clientProject.ownerSessionId;
  return clientProject;
}

export function toProjectDtos(projects: Project[]) {
  return projects.map(toProjectDto);
}

export function projectBelongsToSession(project: Project, sessionId: string) {
  return project.ownerSessionId === sessionId;
}

export function withProjectOwner(project: Project, sessionId: string): OwnedProject {
  return {
    ...project,
    ownerSessionId: sessionId,
  };
}

export function getProjectsForSession(projects: Project[], sessionId: string) {
  return toProjectDtos(projects.filter((project) => projectBelongsToSession(project, sessionId)));
}

export function projectToRows(project: Project) {
  const ownerSessionId = requireProjectOwner(project);
  const rootNode = project.nodes[project.rootNodeId];

  if (!rootNode) {
    throw new Error(`Project ${project.id} is missing root node ${project.rootNodeId}.`);
  }

  const projectRow: ProjectInsert = {
    id: project.id,
    owner_session_id: ownerSessionId,
    title: project.title,
    notes: project.notes,
    root_node_id: project.rootNodeId,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
  const orderedNodes = getPersistenceNodeOrder(project);
  const nodeRows: NodeInsert[] = orderedNodes.map((node) => ({
    id: node.id,
    project_id: project.id,
    parent_id: node.parentId,
    title: node.title,
    title_manually_edited: node.titleManuallyEdited,
    summary: node.summary,
    position_x: node.position.x,
    position_y: node.position.y,
    branch_type: node.branchType,
    collapsed: node.collapsed,
    child_order: getChildOrder(project, node),
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  }));
  const messageRows: MessageInsert[] = orderedNodes.flatMap((node) =>
    node.messages.map((message, index) => ({
      id: message.id,
      project_id: project.id,
      node_id: node.id,
      role: message.role,
      content: message.content,
      attachments: normalizeChatAttachments(message.attachments) as unknown as Json,
      citations: normalizeChatCitations(message.citations) as unknown as Json,
      sort_order: index,
      created_at: message.createdAt,
    })),
  );

  return { projectRow, nodeRows, messageRows };
}

function projectRowsForSchemaCapabilities(
  rows: ReturnType<typeof projectToRows>,
  capabilities: SupabaseProjectSchemaCapabilities,
) {
  const supportedProjectRow = {
    ...rows.projectRow,
  } as ProjectInsert & Record<string, unknown>;
  if (!capabilities.projectNotes) delete supportedProjectRow.notes;

  const supportedNodeRows = rows.nodeRows.map((nodeRow) => {
    const supportedNodeRow = { ...nodeRow } as NodeInsert & Record<string, unknown>;
    if (!capabilities.nodeManualTitles) delete supportedNodeRow.title_manually_edited;
    return supportedNodeRow as NodeInsert;
  });

  const supportedMessageRows = rows.messageRows.map((messageRow) => {
    const supportedMessageRow = {
      ...messageRow,
    } as MessageInsert & Record<string, unknown>;
    if (!capabilities.messageAttachments) delete supportedMessageRow.attachments;
    if (!capabilities.messageCitations) delete supportedMessageRow.citations;
    return supportedMessageRow as MessageInsert;
  });

  return {
    projectRow: supportedProjectRow as ProjectInsert,
    nodeRows: supportedNodeRows,
    messageRows: supportedMessageRows,
  };
}

function getPersistenceNodeOrder(project: Project) {
  const ordered: MindNode[] = [];
  const queuedIds = [project.rootNodeId];
  const seenIds = new Set<string>();

  while (queuedIds.length > 0) {
    const id = queuedIds.shift();
    if (!id || seenIds.has(id)) continue;

    const node = project.nodes[id];
    if (!node) continue;

    ordered.push(node);
    seenIds.add(id);
    queuedIds.push(...node.children);
  }

  for (const node of Object.values(project.nodes)) {
    if (!seenIds.has(node.id)) ordered.push(node);
  }

  return ordered;
}

function getChildOrder(project: Project, node: MindNode) {
  if (!node.parentId) return 0;
  const parent = project.nodes[node.parentId];
  const index = parent?.children.indexOf(node.id) ?? -1;
  return index >= 0 ? index : 0;
}

/**
 * PostgREST returns timestamptz values in its own ISO variant
 * ("2026-07-28T16:19:23.52+00:00") while clients generate timestamps with
 * Date.prototype.toISOString() ("2026-07-28T16:19:23.520Z"). Normalize
 * database timestamps to the canonical JS ISO format so string comparisons
 * (e.g. optimistic-concurrency checks) behave consistently across backends.
 */
function normalizeRowTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

export function composeProjectsFromRows(
  projectRows: ProjectRow[],
  nodeRows: NodeRow[],
  messageRows: MessageRow[],
): OwnedProject[] {
  const messagesByNode = new Map<string, ChatMessage[]>();

  for (const messageRow of messageRows) {
    const messages = messagesByNode.get(messageRow.node_id) ?? [];
    const createdAt = normalizeRowTimestamp(messageRow.created_at);
    messages.push({
      id: messageRow.id,
      role: messageRow.role,
      content: messageRow.content,
      attachments: normalizeChatAttachments((messageRow as Partial<MessageRow>).attachments, {
        fallbackCreatedAt: createdAt,
      }),
      citations: normalizeChatCitations(
        (messageRow as Partial<MessageRow> & { citations?: unknown }).citations,
      ),
      createdAt,
    });
    messagesByNode.set(messageRow.node_id, messages);
  }

  const nodesByProject = new Map<string, NodeRow[]>();
  for (const nodeRow of nodeRows) {
    const rows = nodesByProject.get(nodeRow.project_id) ?? [];
    rows.push(nodeRow);
    nodesByProject.set(nodeRow.project_id, rows);
  }

  return projectRows.map((projectRow) => {
    const projectNodeRows = nodesByProject.get(projectRow.id) ?? [];
    const childrenByParent = new Map<string, string[]>();
    const nodes: Record<string, MindNode> = {};

    for (const nodeRow of projectNodeRows) {
      if (nodeRow.parent_id) {
        const children = childrenByParent.get(nodeRow.parent_id) ?? [];
        children.push(nodeRow.id);
        childrenByParent.set(nodeRow.parent_id, children);
      }

      nodes[nodeRow.id] = {
        id: nodeRow.id,
        projectId: nodeRow.project_id,
        parentId: nodeRow.parent_id,
        title: nodeRow.title,
        titleManuallyEdited:
          typeof (nodeRow as { title_manually_edited?: unknown }).title_manually_edited === "boolean"
            ? nodeRow.title_manually_edited
            : false,
        summary: nodeRow.summary,
        messages: messagesByNode.get(nodeRow.id) ?? [],
        children: [],
        position: { x: nodeRow.position_x, y: nodeRow.position_y },
        branchType: nodeRow.branch_type,
        collapsed: nodeRow.collapsed,
        createdAt: normalizeRowTimestamp(nodeRow.created_at),
        updatedAt: normalizeRowTimestamp(nodeRow.updated_at),
      };
    }

    for (const [nodeId, children] of childrenByParent) {
      const node = nodes[nodeId];
      if (node) node.children = children;
    }

    return {
      id: projectRow.id,
      ownerSessionId: projectRow.owner_session_id,
      title: projectRow.title,
      notes: projectRow.notes ?? "",
      rootNodeId: projectRow.root_node_id,
      nodes,
      createdAt: normalizeRowTimestamp(projectRow.created_at),
      updatedAt: normalizeRowTimestamp(projectRow.updated_at),
    };
  });
}

class SupabaseProjectsRepository implements ProjectsRepository {
  backend: ProjectsBackend = "supabase";

  async readProjects() {
    const client = getSupabaseAdminClient();
    const { data: projectRows, error } = await client
      .from("branchmind_projects")
      .select("*")
      .order("updated_at", { ascending: false });

    assertNoError(error, "read projects");
    return this.compose(projectRows ?? []);
  }

  async readProjectsForSession(sessionId: string) {
    const client = getSupabaseAdminClient();
    const { data: projectRows, error } = await client
      .from("branchmind_projects")
      .select("*")
      .eq("owner_session_id", sessionId)
      .order("updated_at", { ascending: false });

    assertNoError(error, "read session projects");
    return toProjectDtos(await this.compose(projectRows ?? []));
  }

  async writeProjects(projects: Project[]) {
    const client = getSupabaseAdminClient();
    const nextIds = new Set(projects.map((project) => project.id));
    const { data: currentRows, error } = await client
      .from("branchmind_projects")
      .select("id");

    assertNoError(error, "read project ids");

    const idsToDelete = (currentRows ?? [])
      .map((row) => row.id)
      .filter((id) => !nextIds.has(id));
    await this.deleteProjects(idsToDelete);

    for (const project of projects) {
      await this.saveProject(project);
    }
  }

  async updateProjects(
    updater: (projects: OwnedProject[]) => Project[] | Promise<Project[]>,
  ) {
    const projects = await this.readProjects();
    const nextProjects = await updater(projects);
    await this.writeProjects(nextProjects);
    return this.readProjects();
  }

  async saveProject(project: Project) {
    const client = getSupabaseAdminClient();
    const rows = projectToRows(project);

    const rpcError = await this.saveProjectWithRpc(client, rows);
    if (!rpcError) return;

    // Only fall back to per-table writes for recognizable schema mismatches
    // (RPC not deployed yet, or a schema missing optional columns the RPC
    // writes). Any other RPC failure is a real error and must surface.
    if (!isMissingFunctionError(rpcError) && !isMissingColumnError(rpcError)) {
      throw new Error(
        `Supabase save project RPC failed: ${rpcError.message ?? "unknown error"}`,
      );
    }

    console.warn(
      "BranchMind Supabase save project RPC is unavailable; falling back to per-table writes.",
      { projectId: project.id, message: rpcError.message },
    );

    await this.saveProjectPerTable(client, project, rows);
  }

  private async saveProjectWithRpc(
    client: SupabaseClient<Database>,
    rows: ReturnType<typeof projectToRows>,
  ): Promise<SupabaseErrorLike> {
    // database.types.ts is generated and does not include the
    // branchmind_save_project RPC yet, so call it through a loosely typed
    // signature instead of editing the generated file.
    // Supabase's rpc method reads from `this.rest`, so retain the client as
    // its receiver. Calling a detached `client.rpc` function makes `this`
    // undefined and prevents newly generated nodes from being saved.
    const rpc = client.rpc.bind(client) as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: SupabaseErrorLike }>;
    const { error } = await rpc("branchmind_save_project", {
      project_row: rows.projectRow,
      node_rows: rows.nodeRows,
      message_rows: rows.messageRows,
    });
    return error;
  }

  private async saveProjectPerTable(
    client: SupabaseClient<Database>,
    project: Project,
    rows: ReturnType<typeof projectToRows>,
  ) {
    const capabilities = await getSchemaCapabilities(client);
    const existingProject = await client
      .from("branchmind_projects")
      .select("id")
      .eq("id", project.id)
      .limit(1);
    assertNoError(existingProject.error, "read existing project");
    const projectAlreadyExisted = (existingProject.data?.length ?? 0) > 0;

    const persistRows = async (schemaCapabilities: SupabaseProjectSchemaCapabilities) => {
      const {
        projectRow: supportedProjectRow,
        nodeRows: supportedNodeRows,
        messageRows: supportedMessageRows,
      } = projectRowsForSchemaCapabilities(rows, schemaCapabilities);

      const upsertProject = await client
        .from("branchmind_projects")
        .upsert(supportedProjectRow);
      assertNoError(upsertProject.error, "upsert project");

      if (supportedNodeRows.length > 0) {
        const upsertNodes = await client.from("branchmind_nodes").upsert(supportedNodeRows);
        assertNoError(upsertNodes.error, "upsert project nodes");
      }

      if (supportedMessageRows.length > 0) {
        const upsertMessages = await client
          .from("branchmind_messages")
          .upsert(supportedMessageRows);
        assertNoError(upsertMessages.error, "upsert project messages");
      }
    };

    const cleanupNewProject = async () => {
      if (projectAlreadyExisted) return;

      const cleanup = await client
        .from("branchmind_projects")
        .delete()
        .eq("id", project.id);
      if (cleanup.error) {
        console.error("BranchMind Supabase project cleanup failed", {
          projectId: project.id,
          message: cleanup.error.message,
        });
      }
    };

    try {
      await persistRows(capabilities);

      await this.deleteStaleNodes(
        client,
        project.id,
        rows.nodeRows.map((row) => row.id),
      );
    } catch (error) {
      const retryCapabilities = getSchemaCapabilitiesAfterMissingColumnError(
        capabilities,
        error,
      );

      if (retryCapabilities) {
        cacheSchemaCapabilities(retryCapabilities);
        console.warn("BranchMind Supabase schema is missing an optional project column; retrying without it.", {
          projectId: project.id,
        });

        try {
          await persistRows(retryCapabilities);
          await this.deleteStaleNodes(
            client,
            project.id,
            rows.nodeRows.map((row) => row.id),
          );
          return;
        } catch (retryError) {
          await cleanupNewProject();
          throw retryError;
        }
      }

      await cleanupNewProject();
      throw error;
    }
  }

  async updateNodePositionForOwner(
    ownerId: string,
    projectId: string,
    nodeId: string,
    position: NodePosition,
  ) {
    const client = getSupabaseAdminClient();
    const projectLookup = await client
      .from("branchmind_projects")
      .select("*")
      .eq("id", projectId)
      .eq("owner_session_id", ownerId)
      .maybeSingle();
    assertNoError(projectLookup.error, "read existing project");
    if (!projectLookup.data) return null;

    const timestamp = new Date().toISOString();
    const nodeUpdate = await client
      .from("branchmind_nodes")
      .update({
        position_x: position.x,
        position_y: position.y,
        updated_at: timestamp,
      })
      .eq("project_id", projectId)
      .eq("id", nodeId)
      .select("id")
      .maybeSingle();
    assertNoError(nodeUpdate.error, "update node position");
    if (!nodeUpdate.data) return null;

    const projectUpdate = await client
      .from("branchmind_projects")
      .update({ updated_at: timestamp })
      .eq("id", projectId)
      .eq("owner_session_id", ownerId)
      .select("*")
      .maybeSingle();
    assertNoError(projectUpdate.error, "touch project after node position update");

    const [project] = await this.compose([
      projectUpdate.data ?? { ...projectLookup.data, updated_at: timestamp },
    ]);
    return project ? toProjectDto(project) : null;
  }

  async deleteProject(projectId: string) {
    await this.deleteProjects([projectId]);
  }

  async transferOwner(fromOwnerId: string, toOwnerId: string) {
    if (fromOwnerId === toOwnerId) return 0;

    const { data, error } = await getSupabaseAdminClient()
      .from("branchmind_projects")
      .update({ owner_session_id: toOwnerId })
      .eq("owner_session_id", fromOwnerId)
      .select("id");

    assertNoError(error, "transfer project owner");
    return data?.length ?? 0;
  }

  private async deleteProjects(projectIds: string[]) {
    if (projectIds.length === 0) return;

    const { error } = await getSupabaseAdminClient()
      .from("branchmind_projects")
      .delete()
      .in("id", projectIds);
    assertNoError(error, "delete projects");
  }

  private async deleteStaleNodes(
    client: SupabaseClient<Database>,
    projectId: string,
    nextNodeIds: string[],
  ) {
    const { data: currentRows, error } = await client
      .from("branchmind_nodes")
      .select("id")
      .eq("project_id", projectId);
    assertNoError(error, "read project node ids");

    const nextNodeIdSet = new Set(nextNodeIds);
    const staleNodeIds = (currentRows ?? [])
      .map((row) => row.id)
      .filter((id) => !nextNodeIdSet.has(id));

    if (staleNodeIds.length === 0) return;

    const deleteNodes = await client
      .from("branchmind_nodes")
      .delete()
      .eq("project_id", projectId)
      .in("id", staleNodeIds);
    assertNoError(deleteNodes.error, "delete stale project nodes");
  }

  private async compose(projectRows: ProjectRow[]) {
    const projectIds = projectRows.map((row) => row.id);
    if (projectIds.length === 0) return [];

    const client = getSupabaseAdminClient();
    const { data: nodeRows, error: nodeError } = await client
      .from("branchmind_nodes")
      .select("*")
      .in("project_id", projectIds)
      .order("project_id")
      .order("parent_id", { nullsFirst: true })
      .order("child_order");
    assertNoError(nodeError, "read project nodes");

    const { data: messageRows, error: messageError } = await client
      .from("branchmind_messages")
      .select("*")
      .in("project_id", projectIds)
      .order("project_id")
      .order("node_id")
      .order("sort_order");
    assertNoError(messageError, "read project messages");

    return composeProjectsFromRows(projectRows, nodeRows ?? [], messageRows ?? []);
  }
}

const supabaseRepository = new SupabaseProjectsRepository();

const fileRepository: ProjectsRepository = {
  backend: "file",
  readProjects: async () => fileStore.readProjects() as Promise<OwnedProject[]>,
  readProjectsForSession: async (sessionId) =>
    getProjectsForSession(await fileStore.readProjects(), sessionId),
  writeProjects: async (projects) => fileStore.writeProjects(projects),
  updateProjects: async (updater) =>
    fileStore.updateProjects(async (projects) => updater(projects as OwnedProject[])) as Promise<OwnedProject[]>,
  saveProject: async (project) => {
    await fileStore.updateProjects((projects) => {
      const exists = projects.some((item) => item.id === project.id);
      return exists
        ? projects.map((item) => (item.id === project.id ? project : item))
        : [project, ...projects];
    });
  },
  updateNodePositionForOwner: async (ownerId, projectId, nodeId, position) => {
    let updatedProject: Project | null = null;

    await fileStore.updateProjects((projects) => {
      const project = projects.find(
        (item) => item.id === projectId && projectBelongsToSession(item, ownerId),
      );
      const node = project?.nodes[nodeId];
      if (!project || !node) return projects;

      const timestamp = new Date().toISOString();
      updatedProject = {
        ...project,
        nodes: {
          ...project.nodes,
          [nodeId]: {
            ...node,
            position,
            updatedAt: timestamp,
          },
        },
        updatedAt: timestamp,
      };

      return projects.map((item) => (item.id === projectId ? updatedProject! : item));
    });

    return updatedProject ? toProjectDto(updatedProject) : null;
  },
  deleteProject: async (projectId) => {
    await fileStore.updateProjects((projects) =>
      projects.filter((project) => project.id !== projectId),
    );
  },
  transferOwner: async (fromOwnerId, toOwnerId) => {
    if (fromOwnerId === toOwnerId) return 0;

    let transferredCount = 0;
    await fileStore.updateProjects((projects) =>
      projects.map((project) => {
        if (project.ownerSessionId !== fromOwnerId) return project;
        transferredCount += 1;
        return { ...project, ownerSessionId: toOwnerId };
      }),
    );
    return transferredCount;
  },
};

function getConfiguredBackend(): ProjectsBackend | "auto" {
  const value = process.env.BRANCHMIND_PROJECTS_BACKEND?.trim().toLowerCase();
  if (value === "file" || value === "supabase") return value;
  return "auto";
}

export function getProjectsRepository(): ProjectsRepository {
  const backend = getConfiguredBackend();

  if (backend === "file") {
    if (process.env.NODE_ENV === "production" && process.env.BRANCHMIND_ALLOW_FILE_STORE_IN_PRODUCTION !== "true") {
      throw new Error("File project storage is not allowed in production.");
    }

    return fileRepository;
  }

  if (backend === "supabase") {
    requireSupabaseServerConfig();
    return supabaseRepository;
  }

  if (hasSupabaseServerConfig()) return supabaseRepository;
  if (process.env.NODE_ENV === "production") {
    requireSupabaseServerConfig();
  }

  return fileRepository;
}

export async function readProjects() { return getProjectsRepository().readProjects(); }
export async function readProjectsForSession(sessionId: string) { return getProjectsRepository().readProjectsForSession(sessionId); }
export async function writeProjects(projects: Project[]) { return getProjectsRepository().writeProjects(projects); }
export async function updateProjects(updater: (projects: OwnedProject[]) => Project[] | Promise<Project[]>) {
  return getProjectsRepository().updateProjects(updater);
}
export async function transferProjectsOwner(fromOwnerId: string, toOwnerId: string) {
  return getProjectsRepository().transferOwner(fromOwnerId, toOwnerId);
}
