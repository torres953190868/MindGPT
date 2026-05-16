import { normalizeChatAttachments } from "@/lib/chat-attachments";
import {
  getSupabaseAdminClient,
  hasSupabaseServerConfig,
  requireSupabaseServerConfig,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ChatMessage, MindNode, Project } from "@/lib/types";
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
  projectNotes: boolean;
};

export type ProjectsRepository = {
  backend: ProjectsBackend;
  readProjects: () => Promise<OwnedProject[]>;
  readProjectsForSession: (sessionId: string) => Promise<ProjectDto[]>;
  writeProjects: (projects: Project[]) => Promise<void>;
  updateProjects: (updater: (projects: OwnedProject[]) => Project[] | Promise<Project[]>) => Promise<OwnedProject[]>;
  saveProject: (project: Project) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
};

function assertNoError(error: { message: string } | null, operation: string) {
  if (!error) return;
  throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function isMissingColumnError(error: { message: string } | null) {
  return Boolean(
    error?.message &&
      /column .* does not exist|could not find .* column/i.test(error.message),
  );
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
      .select("id,notes", { count: "exact", head: true }),
    client
      .from("branchmind_messages")
      .select("id,attachments", { count: "exact", head: true }),
  ]).then(([projectsResult, messagesResult]) => ({
    projectNotes: !isMissingColumnError(projectsResult.error),
    messageAttachments: !isMissingColumnError(messagesResult.error),
  }));

  return schemaCapabilitiesPromise;
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
      sort_order: index,
      created_at: message.createdAt,
    })),
  );

  return { projectRow, nodeRows, messageRows };
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

export function composeProjectsFromRows(
  projectRows: ProjectRow[],
  nodeRows: NodeRow[],
  messageRows: MessageRow[],
): OwnedProject[] {
  const messagesByNode = new Map<string, ChatMessage[]>();

  for (const messageRow of messageRows) {
    const messages = messagesByNode.get(messageRow.node_id) ?? [];
    messages.push({
      id: messageRow.id,
      role: messageRow.role,
      content: messageRow.content,
      attachments: normalizeChatAttachments((messageRow as Partial<MessageRow>).attachments, {
        fallbackCreatedAt: messageRow.created_at,
      }),
      createdAt: messageRow.created_at,
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
        summary: nodeRow.summary,
        messages: messagesByNode.get(nodeRow.id) ?? [],
        children: [],
        position: { x: nodeRow.position_x, y: nodeRow.position_y },
        branchType: nodeRow.branch_type,
        collapsed: nodeRow.collapsed,
        createdAt: nodeRow.created_at,
        updatedAt: nodeRow.updated_at,
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
      createdAt: projectRow.created_at,
      updatedAt: projectRow.updated_at,
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
    const capabilities = await getSchemaCapabilities(client);
    const { projectRow, nodeRows, messageRows } = projectToRows(project);
    const supportedProjectRow = { ...projectRow } as ProjectInsert & Record<string, unknown>;
    if (!capabilities.projectNotes) delete supportedProjectRow.notes;
    const supportedMessageRows = messageRows.map((messageRow) => {
      const supportedMessageRow = {
        ...messageRow,
      } as MessageInsert & Record<string, unknown>;
      if (!capabilities.messageAttachments) delete supportedMessageRow.attachments;
      return supportedMessageRow as MessageInsert;
    });

    const upsertProject = await client
      .from("branchmind_projects")
      .upsert(supportedProjectRow as ProjectInsert);
    assertNoError(upsertProject.error, "upsert project");

    const deleteMessages = await client
      .from("branchmind_messages")
      .delete()
      .eq("project_id", project.id);
    assertNoError(deleteMessages.error, "delete project messages");

    const deleteNodes = await client
      .from("branchmind_nodes")
      .delete()
      .eq("project_id", project.id);
    assertNoError(deleteNodes.error, "delete project nodes");

    if (nodeRows.length > 0) {
      const insertNodes = await client.from("branchmind_nodes").insert(nodeRows);
      assertNoError(insertNodes.error, "insert project nodes");
    }

    if (supportedMessageRows.length > 0) {
      const insertMessages = await client
        .from("branchmind_messages")
        .insert(supportedMessageRows);
      assertNoError(insertMessages.error, "insert project messages");
    }
  }

  async deleteProject(projectId: string) {
    await this.deleteProjects([projectId]);
  }

  private async deleteProjects(projectIds: string[]) {
    if (projectIds.length === 0) return;

    const { error } = await getSupabaseAdminClient()
      .from("branchmind_projects")
      .delete()
      .in("id", projectIds);
    assertNoError(error, "delete projects");
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
  deleteProject: async (projectId) => {
    await fileStore.updateProjects((projects) =>
      projects.filter((project) => project.id !== projectId),
    );
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
