import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_PROJECT_SYNC_KEY } from "@/lib/client/pending-project-sync";
import type { Project } from "@/lib/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function makeProject(id: string): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const rootNodeId = `${id}_root`;
  return {
    id,
    title: "Synced pending project",
    notes: "",
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        id: rootNodeId,
        projectId: id,
        parentId: null,
        title: "Root",
        titleManuallyEdited: false,
        summary: "Summary",
        messages: [
          {
            id: `${id}_user_message`,
            role: "user",
            content: "Build the thing",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: `${id}_assistant_message`,
            role: "assistant",
            content: "",
            attachments: [],
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

function writePendingProject(project: Project, status: "syncing" | "synced" | "failed") {
  window.localStorage.setItem(
    PENDING_PROJECT_SYNC_KEY,
    JSON.stringify({
      version: 1,
      records: [
        {
          project,
          nodeId: project.rootNodeId,
          assistantMessageId: `${project.id}_assistant_message`,
          status,
          error: null,
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    }),
  );
}

function readStoredPendingRecords() {
  return JSON.parse(window.localStorage.getItem(PENDING_PROJECT_SYNC_KEY) ?? "{}") as {
    records?: unknown[];
  };
}

describe("useBranchMindStore project deletion", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes synced pending projects from the server and does not restore them on force hydrate", async () => {
    const project = makeProject("project_synced_pending");
    let serverProjects = [project];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Response.json({ projects: serverProjects });
      }
      if (
        url === `/api/projects/${project.id}` &&
        init?.method === "DELETE"
      ) {
        serverProjects = [];
        return Response.json({ projects: [] });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    writePendingProject(project, "synced");

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");

    await useBranchMindStore.getState().hydrate({ force: true });
    expect(useBranchMindStore.getState().projects.map((item) => item.id)).toContain(
      project.id,
    );

    await useBranchMindStore.getState().deleteProject(project.id);
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${project.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    expect(useBranchMindStore.getState().projects).toHaveLength(0);
    expect(useBranchMindStore.getState().pendingProjectSyncs[project.id]).toBeUndefined();
    expect(readStoredPendingRecords().records).toEqual([]);

    await useBranchMindStore.getState().hydrate({ force: true });
    expect(useBranchMindStore.getState().projects).toHaveLength(0);
  });

  it("keeps truly unsynced pending project deletes local-only", async () => {
    const project = makeProject("project_unsynced_pending");
    const fetchMock = vi.fn(async () => Response.json({ projects: [project] }));
    vi.stubGlobal("fetch", fetchMock);
    writePendingProject(project, "failed");

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");

    await useBranchMindStore.getState().hydrate({ force: true });
    await useBranchMindStore.getState().deleteProject(project.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useBranchMindStore.getState().projects).toHaveLength(0);
    expect(readStoredPendingRecords().records).toEqual([]);
  });
});

function makeRegenerateProject(): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const rootNodeId = "project_regenerate_root";
  return {
    id: "project_regenerate",
    title: "Regenerate test project",
    notes: "",
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        id: rootNodeId,
        projectId: "project_regenerate",
        parentId: null,
        title: "Root",
        titleManuallyEdited: false,
        summary: "Summary",
        messages: [
          {
            id: "user_a",
            role: "user",
            content: "First prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_a",
            role: "assistant",
            content: "First answer",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "user_b",
            role: "user",
            content: "Second prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_b",
            role: "assistant",
            content: "Second answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: ["project_regenerate_child"],
        position: { x: 0, y: 0 },
        branchType: "root",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      project_regenerate_child: {
        id: "project_regenerate_child",
        projectId: "project_regenerate",
        parentId: rootNodeId,
        title: "Child",
        titleManuallyEdited: false,
        summary: "Child summary",
        messages: [
          {
            id: "user_child",
            role: "user",
            content: "Child prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_child",
            role: "assistant",
            content: "Child answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: [],
        position: { x: 320, y: 0 },
        branchType: "continue",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("useBranchMindStore node deletion", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps project mutations locked until a node deletion completes", async () => {
    const project = makeRegenerateProject();
    const childNodeId = "project_regenerate_child";
    const remainingNodes = { ...project.nodes };
    delete remainingNodes[childNodeId];
    const projectWithoutChild: Project = {
      ...project,
      nodes: {
        ...remainingNodes,
        [project.rootNodeId]: {
          ...project.nodes[project.rootNodeId],
          children: [],
        },
      },
    };
    let resolveDelete: (response: Response) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${childNodeId}` &&
        init?.method === "DELETE"
      ) {
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);
    useBranchMindStore.getState().selectNode(childNodeId);

    const deletion = useBranchMindStore.getState().deleteNode(childNodeId);
    expect(useBranchMindStore.getState().creatingNodeId).toBe(childNodeId);

    await expect(
      useBranchMindStore.getState().updateNodeTitle(project.rootNodeId, "Renamed root"),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/projects/${project.id}/nodes/${project.rootNodeId}`,
      expect.objectContaining({ method: "PATCH" }),
    );

    resolveDelete(
      Response.json({ project: projectWithoutChild, selectedNodeId: project.rootNodeId }),
    );
    await deletion;
    expect(useBranchMindStore.getState().creatingNodeId).toBeNull();
  });
});

describe("useBranchMindStore regenerate", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchWithDeferredRegenerate(project: Project) {
    let resolveRegenerate: (response: Response) => void = () => {};
    let rejectRegenerate: (error: Error) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (url === `/api/projects/${project.id}/nodes/${project.rootNodeId}/regenerate`) {
        return new Promise<Response>((resolve, reject) => {
          resolveRegenerate = resolve;
          rejectRegenerate = reject;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    return {
      fetchMock,
      resolveRegenerate: (response: Response) => resolveRegenerate(response),
      rejectRegenerate: (error: Error) => rejectRegenerate(error),
    };
  }

  function applyConcurrentChange(
    store: typeof import("@/store/useBranchMindStore").useBranchMindStore,
    projectId: string,
  ) {
    store.setState((state) => ({
      projects: state.projects.map((item) =>
        item.id === projectId
          ? {
              ...item,
              notes: "Notes written during streaming",
              updatedAt: "2026-01-03T00:00:00.000Z",
              nodes: {
                ...item.nodes,
                project_regenerate_child: {
                  ...item.nodes.project_regenerate_child,
                  position: { x: 7, y: 7 },
                },
              },
            }
          : item,
      ),
    }));
  }

  it("restores only the regenerated messages on failure and keeps other changes", async () => {
    const project = makeRegenerateProject();
    const { rejectRegenerate } = stubFetchWithDeferredRegenerate(project);
    const { useBranchMindStore } = await import("@/store/useBranchMindStore");

    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const started = await useBranchMindStore
      .getState()
      .editUserMessage(project.rootNodeId, "user_b", "Edited second prompt");
    expect(started).toBe(true);

    const draft = useBranchMindStore.getState().projects[0];
    expect(draft.title).toBe("Edited second prompt");
    expect(
      draft.nodes[project.rootNodeId].messages.map((message) => message.content),
    ).toEqual(["First prompt", "First answer", "Edited second prompt", ""]);

    applyConcurrentChange(useBranchMindStore, project.id);
    rejectRegenerate(new Error("Network down"));

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().aiError).toBe("Network down");
    });

    const restored = useBranchMindStore.getState().projects[0];
    expect(restored.title).toBe("Regenerate test project");
    expect(restored.notes).toBe("Notes written during streaming");
    expect(restored.updatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(restored.nodes.project_regenerate_child.position).toEqual({ x: 7, y: 7 });
    expect(
      restored.nodes[project.rootNodeId].messages.map((message) => message.content),
    ).toEqual(["First prompt", "First answer", "Second prompt", "Second answer"]);
    expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
  });

  it("merges only the regenerated node on success and keeps other changes", async () => {
    const project = makeRegenerateProject();
    const { fetchMock, resolveRegenerate } = stubFetchWithDeferredRegenerate(project);
    const { useBranchMindStore } = await import("@/store/useBranchMindStore");

    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const started = await useBranchMindStore
      .getState()
      .editUserMessage(project.rootNodeId, "user_b", "Edited second prompt");
    expect(started).toBe(true);

    applyConcurrentChange(useBranchMindStore, project.id);

    const serverNode = {
      ...project.nodes[project.rootNodeId],
      title: "Regenerated title",
      summary: "Regenerated summary",
      messages: project.nodes[project.rootNodeId].messages.map((message) =>
        message.id === "user_b"
          ? { ...message, content: "Edited second prompt" }
          : message.id === "assistant_b"
            ? { ...message, content: "Regenerated answer" }
            : message,
      ),
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const serverProject = {
      ...project,
      title: "Edited second prompt",
      updatedAt: "2026-01-02T00:00:00.000Z",
      nodes: { ...project.nodes, [project.rootNodeId]: serverNode },
    };
    resolveRegenerate(
      new Response(
        `event: complete\ndata: ${JSON.stringify({ project: serverProject, node: serverNode })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });

    const merged = useBranchMindStore.getState().projects[0];
    expect(useBranchMindStore.getState().aiError).toBeNull();
    expect(merged.title).toBe("Edited second prompt");
    expect(merged.notes).toBe("Notes written during streaming");
    expect(merged.updatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(merged.nodes.project_regenerate_child.position).toEqual({ x: 7, y: 7 });
    expect(merged.nodes[project.rootNodeId].title).toBe("Regenerated title");
    expect(
      merged.nodes[project.rootNodeId].messages.map((message) => message.content),
    ).toEqual(["First prompt", "First answer", "Edited second prompt", "Regenerated answer"]);

    const regenerateCall = fetchMock.mock.calls.find(([input]) =>
      input.toString().endsWith("/regenerate"),
    );
    expect(regenerateCall).toBeDefined();
    const body = JSON.parse(String(regenerateCall?.[1]?.body)) as Record<string, unknown>;
    expect(body.expectedNodeUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.userMessageId).toBe("user_b");
    expect(body.assistantMessageId).toBe("assistant_b");
  });
});
