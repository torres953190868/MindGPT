import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeProjectsFromRows,
  getProjectsRepository,
  projectToRows,
  readProjectForOwner,
  readProjectOwnerId,
  type OwnedProject,
} from "@/lib/server/projects-repository";
import type { Database } from "@/lib/supabase/database.types";
import type { Project } from "@/lib/types";

type ProjectRow = Database["public"]["Tables"]["branchmind_projects"]["Row"];
type NodeRow = Database["public"]["Tables"]["branchmind_nodes"]["Row"];
type MessageRow = Database["public"]["Tables"]["branchmind_messages"]["Row"];

const supabaseServerMock = vi.hoisted(() => {
  const state: { client: unknown } = { client: null };
  return {
    state,
    hasSupabaseServerConfig: vi.fn(() => true),
    getSupabaseAdminClient: vi.fn(() => state.client),
    requireSupabaseServerConfig: vi.fn(),
  };
});

const fileStoreMock = vi.hoisted(() => ({
  readProjects: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: supabaseServerMock.hasSupabaseServerConfig,
  getSupabaseAdminClient: supabaseServerMock.getSupabaseAdminClient,
  requireSupabaseServerConfig: supabaseServerMock.requireSupabaseServerConfig,
}));

vi.mock("@/lib/server/projects-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/projects-store")>();
  return {
    ...actual,
    readProjects: fileStoreMock.readProjects,
  };
});

const timestamp = "2026-01-01T00:00:00.000Z";

function makeProject(): Project {
  return {
    id: "project-repository-test",
    ownerSessionId: "owner-session",
    title: "Repository test",
    notes: "## Saved notes",
    rootNodeId: "node-root-repository-test",
    nodes: {
      "node-root-repository-test": {
        id: "node-root-repository-test",
        projectId: "project-repository-test",
        parentId: null,
        title: "Root",
        titleManuallyEdited: true,
        summary: "Root summary",
        messages: [
          {
            id: "message-with-attachment",
            role: "user",
            content: "Prompt with file",
            attachments: [
              {
                id: "attachment-repository-test",
                name: "dataset.csv",
                mimeType: "text/csv",
                size: 1024,
                createdAt: timestamp,
              },
            ],
            createdAt: timestamp,
          },
          {
            id: "message-with-citation",
            role: "assistant",
            content: "Answer with source [[cite:1]]",
            attachments: [],
            citations: [
              {
                index: 1,
                documentId: "document-repository-test",
                documentName: "source.pdf",
                chunkId: "chunk-repository-test",
                pageStart: 2,
                pageEnd: 3,
                headingPath: ["Chapter 1"],
                quote: "Repository citation text.",
              },
            ],
            createdAt: timestamp,
          },
        ],
        children: [],
        position: { x: 0, y: 0 },
        branchType: "root",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("projects repository row mapping", () => {
  it("writes and reads project notes in Supabase rows", () => {
    const project = makeProject();
    const { projectRow, nodeRows, messageRows } = projectToRows(project);
    const persistedProjectRow = {
      ...projectRow,
      notes: projectRow.notes ?? "",
      created_at: projectRow.created_at ?? timestamp,
      updated_at: projectRow.updated_at ?? timestamp,
    };

    expect(projectRow.notes).toBe("## Saved notes");
    expect(nodeRows[0].title_manually_edited).toBe(true);

    const [composed] = composeProjectsFromRows(
      [persistedProjectRow],
      nodeRows.map((nodeRow) => ({
        ...nodeRow,
        parent_id: nodeRow.parent_id ?? null,
        title_manually_edited: nodeRow.title_manually_edited ?? false,
        summary: nodeRow.summary ?? "",
        position_x: nodeRow.position_x ?? 0,
        position_y: nodeRow.position_y ?? 0,
        collapsed: nodeRow.collapsed ?? false,
        child_order: nodeRow.child_order ?? 0,
        created_at: nodeRow.created_at ?? timestamp,
        updated_at: nodeRow.updated_at ?? timestamp,
      })),
      messageRows.map((messageRow) => ({
        ...messageRow,
        attachments: messageRow.attachments ?? [],
        citations: messageRow.citations ?? [],
        sort_order: messageRow.sort_order ?? 0,
        created_at: messageRow.created_at ?? timestamp,
      })),
    );

    expect(composed.notes).toBe("## Saved notes");
    const rootNode = composed.nodes[composed.rootNodeId];
    expect(rootNode.titleManuallyEdited).toBe(true);
    expect(rootNode.messages[0].attachments).toEqual(
      project.nodes[project.rootNodeId].messages[0].attachments,
    );
    expect(rootNode.messages[1].citations).toEqual(
      project.nodes[project.rootNodeId].messages[1].citations,
    );
  });

  it("normalizes PostgREST timestamptz strings to canonical ISO format", () => {
    const project = makeProject();
    const { projectRow, nodeRows, messageRows } = projectToRows(project);
    // PostgREST renders timestamptz without zero-padded fractions and with a
    // numeric offset, e.g. "2026-01-01T00:00:00+00:00".
    const postgrestTimestamp = "2026-01-01T00:00:00+00:00";

    const [composed] = composeProjectsFromRows(
      [{
        ...projectRow,
        notes: projectRow.notes ?? "",
        created_at: postgrestTimestamp,
        updated_at: postgrestTimestamp,
      }],
      nodeRows.map((nodeRow) => ({
        ...nodeRow,
        parent_id: nodeRow.parent_id ?? null,
        title_manually_edited: nodeRow.title_manually_edited ?? false,
        summary: nodeRow.summary ?? "",
        position_x: nodeRow.position_x ?? 0,
        position_y: nodeRow.position_y ?? 0,
        collapsed: nodeRow.collapsed ?? false,
        child_order: nodeRow.child_order ?? 0,
        created_at: postgrestTimestamp,
        updated_at: postgrestTimestamp,
      })),
      messageRows.map((messageRow) => ({
        ...messageRow,
        attachments: messageRow.attachments ?? [],
        citations: messageRow.citations ?? [],
        sort_order: messageRow.sort_order ?? 0,
        created_at: postgrestTimestamp,
      })),
    );

    expect(composed.createdAt).toBe(timestamp);
    expect(composed.updatedAt).toBe(timestamp);
    const rootNode = composed.nodes[composed.rootNodeId];
    expect(rootNode.createdAt).toBe(timestamp);
    expect(rootNode.updatedAt).toBe(timestamp);
    expect(rootNode.messages[0].createdAt).toBe(timestamp);
  });
});

type MockedCall = { fn: string; args: Record<string, unknown> };
type RecordedUpsert = { table: string; rows: unknown };

function createSupabaseClientMock(rpcError: { code?: string; message: string } | null) {
  const upserts: RecordedUpsert[] = [];
  const rpcCalls: MockedCall[] = [];

  const client = {
    rest: { rpcCalls },
    rpc: vi.fn(async function (
      this: { rest: { rpcCalls: MockedCall[] } },
      fn: string,
      args: Record<string, unknown>,
    ) {
      this.rest.rpcCalls.push({ fn, args });
      return { data: null, error: rpcError };
    }),
    from: vi.fn((table: string) => {
      const ops: string[] = [];
      const query: Record<string, unknown> = {};
      const chain =
        (method: string) =>
        (...args: unknown[]) => {
          ops.push(method);
          if (method === "upsert") upserts.push({ table, rows: args[0] });
          return query;
        };
      for (const method of [
        "select",
        "upsert",
        "insert",
        "update",
        "delete",
        "eq",
        "in",
        "limit",
        "order",
        "maybeSingle",
        "single",
      ]) {
        query[method] = chain(method);
      }
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const isSelect = ops[0] === "select";
        const isExistingProjectLookup =
          table === "branchmind_projects" && isSelect && ops.includes("eq");
        const result = {
          data: isSelect ? (isExistingProjectLookup ? [{ id: "project-repository-test" }] : []) : null,
          error: null,
        };
        return Promise.resolve(result).then(resolve, reject);
      };
      return query;
    }),
  };

  return { client, upserts, rpcCalls };
}

describe("SupabaseProjectsRepository.saveProject", () => {
  afterEach(() => {
    supabaseServerMock.state.client = null;
    vi.restoreAllMocks();
  });

  it("saves through the RPC without per-table upserts when available", async () => {
    const mock = createSupabaseClientMock(null);
    supabaseServerMock.state.client = mock.client;
    const project = makeProject();

    await getProjectsRepository().saveProject(project);

    const rows = projectToRows(project);
    expect(mock.rpcCalls).toHaveLength(1);
    expect(mock.rpcCalls[0].fn).toBe("branchmind_save_project");
    expect(mock.rpcCalls[0].args.project_row).toEqual(rows.projectRow);
    expect(mock.rpcCalls[0].args.node_rows).toEqual(rows.nodeRows);
    expect(mock.rpcCalls[0].args.message_rows).toEqual(rows.messageRows);
    expect(mock.upserts).toHaveLength(0);
    expect(mock.client.from).not.toHaveBeenCalled();
  });

  it("falls back to per-table writes when the RPC function does not exist", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = createSupabaseClientMock({
      code: "PGRST202",
      message:
        "Could not find the function public.branchmind_save_project(message_rows, node_rows, project_row) in the schema cache",
    });
    supabaseServerMock.state.client = mock.client;
    const project = makeProject();

    await getProjectsRepository().saveProject(project);

    expect(warn).toHaveBeenCalled();
    expect(mock.upserts.map((upsert) => upsert.table)).toEqual([
      "branchmind_projects",
      "branchmind_nodes",
      "branchmind_messages",
    ]);
    const rows = projectToRows(project);
    expect(mock.upserts[0].rows).toEqual(rows.projectRow);
    expect(mock.upserts[1].rows).toEqual(rows.nodeRows);
    expect(mock.upserts[2].rows).toEqual(rows.messageRows);
  });

  it("falls back when the RPC fails with a missing-column schema error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = createSupabaseClientMock({
      code: "42703",
      message: 'column "notes" of relation "branchmind_projects" does not exist',
    });
    supabaseServerMock.state.client = mock.client;

    await getProjectsRepository().saveProject(makeProject());

    expect(warn).toHaveBeenCalled();
    expect(mock.upserts.map((upsert) => upsert.table)).toEqual([
      "branchmind_projects",
      "branchmind_nodes",
      "branchmind_messages",
    ]);
  });

  it("rethrows unexpected RPC errors without falling back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mock = createSupabaseClientMock({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    supabaseServerMock.state.client = mock.client;

    await expect(getProjectsRepository().saveProject(makeProject())).rejects.toThrow(
      /save project RPC failed/,
    );

    expect(warn).not.toHaveBeenCalled();
    expect(mock.upserts).toHaveLength(0);
  });
});

type RecordedSelectQuery = {
  table: string;
  selectColumns: string;
  eqFilters: Array<[string, unknown]>;
  inFilters: Array<[string, unknown[]]>;
  orderColumns: string[];
  range: [number, number] | null;
  maybeSingle: boolean;
};

function toPersistedRows(project: Project): {
  projectRow: ProjectRow;
  nodeRows: NodeRow[];
  messageRows: MessageRow[];
} {
  const { projectRow, nodeRows, messageRows } = projectToRows(project);
  return {
    projectRow: {
      ...projectRow,
      notes: projectRow.notes ?? "",
      created_at: projectRow.created_at ?? timestamp,
      updated_at: projectRow.updated_at ?? timestamp,
    },
    nodeRows: nodeRows.map((nodeRow) => ({
      ...nodeRow,
      parent_id: nodeRow.parent_id ?? null,
      title_manually_edited: nodeRow.title_manually_edited ?? false,
      summary: nodeRow.summary ?? "",
      position_x: nodeRow.position_x ?? 0,
      position_y: nodeRow.position_y ?? 0,
      collapsed: nodeRow.collapsed ?? false,
      child_order: nodeRow.child_order ?? 0,
      created_at: nodeRow.created_at ?? timestamp,
      updated_at: nodeRow.updated_at ?? timestamp,
    })),
    messageRows: messageRows.map((messageRow) => ({
      ...messageRow,
      attachments: messageRow.attachments ?? [],
      citations: messageRow.citations ?? [],
      sort_order: messageRow.sort_order ?? 0,
      created_at: messageRow.created_at ?? timestamp,
    })),
  };
}

function createInMemorySupabaseSelectMock(options: {
  projects?: ProjectRow[];
  nodes?: NodeRow[];
  messages?: MessageRow[];
  includeRangeMethod?: boolean;
}) {
  const projectRows = options.projects ?? [];
  const nodeRows = options.nodes ?? [];
  const messageRows = options.messages ?? [];
  const includeRangeMethod = options.includeRangeMethod ?? true;
  const queries: RecordedSelectQuery[] = [];

  const getTableRows = (table: string): Array<Record<string, unknown>> => {
    if (table === "branchmind_projects") return projectRows as Array<Record<string, unknown>>;
    if (table === "branchmind_nodes") return nodeRows as Array<Record<string, unknown>>;
    if (table === "branchmind_messages") return messageRows as Array<Record<string, unknown>>;
    return [];
  };

  const client = {
    from: vi.fn((table: string) => {
      const recorded: RecordedSelectQuery = {
        table,
        selectColumns: "*",
        eqFilters: [],
        inFilters: [],
        orderColumns: [],
        range: null,
        maybeSingle: false,
      };
      queries.push(recorded);

      const query: Record<string, unknown> = {
        select: (columns = "*") => {
          recorded.selectColumns = columns;
          return query;
        },
        eq: (column: string, value: unknown) => {
          recorded.eqFilters.push([column, value]);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          recorded.inFilters.push([column, values]);
          return query;
        },
        order: (column: string) => {
          recorded.orderColumns.push(column);
          return query;
        },
        maybeSingle: () => {
          recorded.maybeSingle = true;
          return query;
        },
      };

      if (includeRangeMethod) {
        query.range = (from: number, to: number) => {
          recorded.range = [from, to];
          return query;
        };
      }

      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        let rows = [...getTableRows(table)];
        for (const [column, value] of recorded.eqFilters) {
          rows = rows.filter((row) => row[column] === value);
        }
        for (const [column, values] of recorded.inFilters) {
          const allowed = new Set(values);
          rows = rows.filter((row) => allowed.has(row[column]));
        }

        if (recorded.maybeSingle) {
          const first = rows[0] ?? null;
          if (!first) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          if (recorded.selectColumns !== "*") {
            const picked: Record<string, unknown> = {};
            for (const col of recorded.selectColumns.split(",").map((s) => s.trim())) {
              picked[col] = first[col];
            }
            return Promise.resolve({ data: picked, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: first, error: null }).then(resolve, reject);
        }

        const sliced = recorded.range
          ? rows.slice(recorded.range[0], recorded.range[1] + 1)
          : rows;

        return Promise.resolve({ data: sliced, error: null }).then(resolve, reject);
      };

      return query;
    }),
  };

  return { client, queries };
}

describe("SupabaseProjectsRepository targeted single-project lookups", () => {
  afterEach(() => {
    supabaseServerMock.state.client = null;
    supabaseServerMock.hasSupabaseServerConfig.mockReturnValue(true);
    delete process.env.BRANCHMIND_PROJECTS_BACKEND;
    vi.restoreAllMocks();
  });

  it("readProjectForOwner filters by id and owner_session_id and composes nodes and messages when found", async () => {
    const ownedProject = makeProject();
    const otherProject: Project = {
      ...makeProject(),
      id: "project-other-user",
      ownerSessionId: "other-session",
      title: "Other user's project",
    };
    const ownedRows = toPersistedRows(ownedProject);
    const otherRows = toPersistedRows(otherProject);

    const mock = createInMemorySupabaseSelectMock({
      projects: [ownedRows.projectRow, otherRows.projectRow],
      nodes: [...ownedRows.nodeRows, ...otherRows.nodeRows],
      messages: [...ownedRows.messageRows, ...otherRows.messageRows],
    });
    supabaseServerMock.state.client = mock.client;

    const result = await readProjectForOwner("owner-session", "project-repository-test");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("project-repository-test");
    expect(result?.ownerSessionId).toBe("owner-session");
    expect(result?.nodes["node-root-repository-test"].messages).toHaveLength(2);

    const projectQuery = mock.queries[0];
    expect(projectQuery).toMatchObject({
      table: "branchmind_projects",
      selectColumns: "*",
      eqFilters: [
        ["id", "project-repository-test"],
        ["owner_session_id", "owner-session"],
      ],
      maybeSingle: true,
    });
    expect(mock.queries.map((q) => q.table)).toEqual([
      "branchmind_projects",
      "branchmind_nodes",
      "branchmind_messages",
    ]);
    expect(mock.queries[1].inFilters).toEqual([["project_id", ["project-repository-test"]]]);
    expect(mock.queries[2].inFilters).toEqual([["project_id", ["project-repository-test"]]]);
  });

  it("readProjectForOwner returns null without querying nodes or messages when missing or owned by someone else", async () => {
    const otherProject: Project = {
      ...makeProject(),
      ownerSessionId: "other-session",
    };
    const otherRows = toPersistedRows(otherProject);
    const mock = createInMemorySupabaseSelectMock({
      projects: [otherRows.projectRow],
      nodes: otherRows.nodeRows,
      messages: otherRows.messageRows,
    });
    supabaseServerMock.state.client = mock.client;

    const wrongOwnerResult = await getProjectsRepository().readProjectForOwner(
      "owner-session",
      otherProject.id,
    );
    expect(wrongOwnerResult).toBeNull();

    const missingResult = await getProjectsRepository().readProjectForOwner(
      "owner-session",
      "project-does-not-exist",
    );
    expect(missingResult).toBeNull();

    // Only branchmind_projects was queried; zero queries to nodes or messages!
    expect(mock.queries.map((q) => q.table)).toEqual([
      "branchmind_projects",
      "branchmind_projects",
    ]);
  });

  it("readProjectForOwner returns null immediately when ownerId or projectId is empty", async () => {
    const mock = createInMemorySupabaseSelectMock({});
    supabaseServerMock.state.client = mock.client;

    await expect(readProjectForOwner("   ", "project-repository-test")).resolves.toBeNull();
    await expect(readProjectForOwner("owner-session", "   ")).resolves.toBeNull();
    expect(mock.client.from).not.toHaveBeenCalled();
  });

  it("readProjectOwnerId queries owner_session_id only and returns owner string or null", async () => {
    const ownedRows = toPersistedRows(makeProject());
    const mock = createInMemorySupabaseSelectMock({
      projects: [ownedRows.projectRow],
      nodes: ownedRows.nodeRows,
      messages: ownedRows.messageRows,
    });
    supabaseServerMock.state.client = mock.client;

    await expect(readProjectOwnerId("project-repository-test")).resolves.toBe("owner-session");
    await expect(readProjectOwnerId("project-missing")).resolves.toBeNull();
    await expect(readProjectOwnerId("   ")).resolves.toBeNull();

    expect(mock.queries).toHaveLength(2);
    expect(mock.queries[0]).toMatchObject({
      table: "branchmind_projects",
      selectColumns: "owner_session_id",
      eqFilters: [["id", "project-repository-test"]],
      maybeSingle: true,
    });
    expect(mock.queries[1]).toMatchObject({
      table: "branchmind_projects",
      selectColumns: "owner_session_id",
      eqFilters: [["id", "project-missing"]],
      maybeSingle: true,
    });
  });
});

describe("SupabaseProjectsRepository PostgREST pagination & batching", () => {
  afterEach(() => {
    supabaseServerMock.state.client = null;
    supabaseServerMock.hasSupabaseServerConfig.mockReturnValue(true);
    delete process.env.BRANCHMIND_PROJECTS_BACKEND;
    vi.restoreAllMocks();
  });

  it("paginates branchmind_messages across multiple 1,000-row pages without truncation", async () => {
    const project = makeProject();
    const baseRows = toPersistedRows(project);
    const totalMessages = 1250;
    const manyMessageRows: MessageRow[] = Array.from({ length: totalMessages }, (_, index) => ({
      id: `msg_${String(index).padStart(4, "0")}`,
      project_id: project.id,
      node_id: project.rootNodeId,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message #${index}`,
      attachments: [],
      citations: [],
      sort_order: index,
      created_at: timestamp,
    }));

    const mock = createInMemorySupabaseSelectMock({
      projects: [baseRows.projectRow],
      nodes: baseRows.nodeRows,
      messages: manyMessageRows,
    });
    supabaseServerMock.state.client = mock.client;

    const composed = await getProjectsRepository().readProjectForOwner(
      "owner-session",
      project.id,
    );

    expect(composed).not.toBeNull();
    const rootMessages = composed!.nodes[project.rootNodeId].messages;
    expect(rootMessages).toHaveLength(1250);
    expect(rootMessages[0].id).toBe("msg_0000");
    expect(rootMessages[999].id).toBe("msg_0999");
    expect(rootMessages[1000].id).toBe("msg_1000");
    expect(rootMessages[1249].id).toBe("msg_1249");

    const nodeQueries = mock.queries.filter((q) => q.table === "branchmind_nodes");
    expect(nodeQueries).toHaveLength(1);
    expect(nodeQueries[0].range).toEqual([0, 999]);
    expect(nodeQueries[0].orderColumns).toEqual([
      "project_id",
      "parent_id",
      "child_order",
      "id",
    ]);

    const messageQueries = mock.queries.filter((q) => q.table === "branchmind_messages");
    expect(messageQueries).toHaveLength(2);
    expect(messageQueries[0].range).toEqual([0, 999]);
    expect(messageQueries[1].range).toEqual([1000, 1999]);
    expect(messageQueries[0].orderColumns).toEqual([
      "project_id",
      "node_id",
      "sort_order",
      "id",
    ]);
  });

  it("chunks projectIds in batches of 200 when composing more than 200 projects", async () => {
    const projectCount = 205;
    const projects: ProjectRow[] = [];
    const nodes: NodeRow[] = [];
    const messages: MessageRow[] = [];

    for (let index = 0; index < projectCount; index += 1) {
      const projectId = `project_${String(index).padStart(3, "0")}`;
      const rootNodeId = `node_${String(index).padStart(3, "0")}`;
      const persisted = toPersistedRows({
        ...makeProject(),
        id: projectId,
        ownerSessionId: "owner-session",
        rootNodeId,
        nodes: {
          [rootNodeId]: {
            ...makeProject().nodes["node-root-repository-test"],
            id: rootNodeId,
            projectId,
          },
        },
      });
      projects.push(persisted.projectRow);
      nodes.push(...persisted.nodeRows);
      messages.push(...persisted.messageRows);
    }

    const mock = createInMemorySupabaseSelectMock({
      projects,
      nodes,
      messages,
    });
    supabaseServerMock.state.client = mock.client;

    const sessionProjects = await getProjectsRepository().readProjectsForSession("owner-session");

    expect(sessionProjects).toHaveLength(205);
    const nodeQueries = mock.queries.filter((q) => q.table === "branchmind_nodes");
    expect(nodeQueries).toHaveLength(2);
    expect(nodeQueries[0].inFilters[0][1]).toHaveLength(200);
    expect(nodeQueries[1].inFilters[0][1]).toHaveLength(5);
  });

  it("gracefully awaits minimal query mocks that omit .range as a single page", async () => {
    const persisted = toPersistedRows(makeProject());
    const mock = createInMemorySupabaseSelectMock({
      projects: [persisted.projectRow],
      nodes: persisted.nodeRows,
      messages: persisted.messageRows,
      includeRangeMethod: false,
    });
    supabaseServerMock.state.client = mock.client;

    const sessionProjects = await getProjectsRepository().readProjectsForSession("owner-session");
    expect(sessionProjects).toHaveLength(1);
    expect(sessionProjects[0].id).toBe("project-repository-test");
  });
});

describe("fileRepository targeted single-project lookups", () => {
  afterEach(() => {
    fileStoreMock.readProjects.mockReset();
    supabaseServerMock.hasSupabaseServerConfig.mockReturnValue(true);
    delete process.env.BRANCHMIND_PROJECTS_BACKEND;
    vi.restoreAllMocks();
  });

  it("implements readProjectForOwner and readProjectOwnerId on fileRepository", async () => {
    process.env.BRANCHMIND_PROJECTS_BACKEND = "file";
    supabaseServerMock.hasSupabaseServerConfig.mockReturnValue(false);

    const ownedA: OwnedProject = {
      ...makeProject(),
      id: "project_file_a",
      ownerSessionId: "owner_a",
    };
    const ownedB: OwnedProject = {
      ...makeProject(),
      id: "project_file_b",
      ownerSessionId: "owner_b",
    };
    fileStoreMock.readProjects.mockResolvedValue([ownedA, ownedB]);

    const repo = getProjectsRepository();
    expect(repo.backend).toBe("file");

    await expect(repo.readProjectForOwner("owner_a", "project_file_a")).resolves.toEqual(ownedA);
    await expect(repo.readProjectForOwner("owner_a", "project_file_b")).resolves.toBeNull();
    await expect(repo.readProjectForOwner("owner_a", "project_missing")).resolves.toBeNull();

    await expect(repo.readProjectOwnerId("project_file_a")).resolves.toBe("owner_a");
    await expect(repo.readProjectOwnerId("project_file_b")).resolves.toBe("owner_b");
    await expect(repo.readProjectOwnerId("project_missing")).resolves.toBeNull();

    fileStoreMock.readProjects.mockClear();
    await expect(repo.readProjectForOwner("", "project_file_a")).resolves.toBeNull();
    await expect(repo.readProjectOwnerId("   ")).resolves.toBeNull();
    expect(fileStoreMock.readProjects).not.toHaveBeenCalled();
  });
});
