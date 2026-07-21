import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeProjectsFromRows,
  getProjectsRepository,
  projectToRows,
} from "@/lib/server/projects-repository";
import type { Project } from "@/lib/types";

const supabaseServerMock = vi.hoisted(() => {
  const state: { client: unknown } = { client: null };
  return {
    state,
    hasSupabaseServerConfig: vi.fn(() => true),
    getSupabaseAdminClient: vi.fn(() => state.client),
    requireSupabaseServerConfig: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: supabaseServerMock.hasSupabaseServerConfig,
  getSupabaseAdminClient: supabaseServerMock.getSupabaseAdminClient,
  requireSupabaseServerConfig: supabaseServerMock.requireSupabaseServerConfig,
}));

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
