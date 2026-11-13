import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_PROJECT_SYNC_KEY } from "@/lib/client/pending-project-sync";
import { LANGUAGE_STORAGE_KEY } from "@/lib/language";
import { LANGUAGE_COPY } from "@/lib/language-copy";
import type {
  ChatAttachment,
  ChatModelSelection,
  ChatSkill,
  Project,
} from "@/lib/types";
import { ReadOnlyStorage, stubBlockedStorageWindow, stubStorageWindow } from "./blocked-storage";

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

async function waitForPendingResponseCount(
  responses: unknown[],
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (responses.length === count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(responses).toHaveLength(count);
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

  function makeDeletionTreeProject(projectId = "project_delete_race"): Project {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const rootId = `${projectId}_root`;
    const makeTestNode = (
      id: string,
      parentId: string | null,
      children: string[] = [],
      title = id,
      position = { x: 0, y: 0 },
    ) => ({
      id,
      projectId,
      parentId,
      title,
      titleManuallyEdited: false,
      summary: `${title} summary`,
      messages: [
        {
          id: `${id}_user`,
          role: "user" as const,
          content: `${title} prompt`,
          attachments: [],
          createdAt: timestamp,
        },
        {
          id: `${id}_assistant`,
          role: "assistant" as const,
          content: `${title} answer`,
          attachments: [],
          createdAt: timestamp,
        },
      ],
      children,
      position,
      branchType: (parentId === null ? "root" : "branch") as "root" | "branch",
      collapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      id: projectId,
      title: `Project ${projectId}`,
      notes: "",
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeTestNode(
          rootId,
          null,
          [
            `${projectId}_a`,
            `${projectId}_b`,
            `${projectId}_c`,
            `${projectId}_parent`,
            `${projectId}_keep`,
          ],
          "Root",
          { x: 0, y: 0 },
        ),
        [`${projectId}_a`]: makeTestNode(`${projectId}_a`, rootId, [], "Node A", {
          x: 320,
          y: 0,
        }),
        [`${projectId}_b`]: makeTestNode(`${projectId}_b`, rootId, [], "Node B", {
          x: 320,
          y: 260,
        }),
        [`${projectId}_c`]: makeTestNode(`${projectId}_c`, rootId, [], "Node C", {
          x: 320,
          y: 520,
        }),
        [`${projectId}_parent`]: makeTestNode(
          `${projectId}_parent`,
          rootId,
          [`${projectId}_child`],
          "Parent",
          { x: 640, y: 0 },
        ),
        [`${projectId}_child`]: makeTestNode(
          `${projectId}_child`,
          `${projectId}_parent`,
          [`${projectId}_grandchild`],
          "Child",
          { x: 960, y: 0 },
        ),
        [`${projectId}_grandchild`]: makeTestNode(
          `${projectId}_grandchild`,
          `${projectId}_child`,
          [],
          "Grandchild",
          { x: 1280, y: 0 },
        ),
        [`${projectId}_keep`]: makeTestNode(`${projectId}_keep`, rootId, [], "Keep", {
          x: 320,
          y: 780,
        }),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function serverDeleteSubtree(
    project: Project,
    nodeId: string,
    updatedAt: string,
  ): { project: Project; selectedNodeId: string } {
    const target = project.nodes[nodeId];
    if (!target || target.parentId === null) {
      throw new Error(`Cannot delete ${nodeId}`);
    }
    const toRemove = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (toRemove.has(current)) continue;
      toRemove.add(current);
      project.nodes[current]?.children.forEach((childId) => stack.push(childId));
    }

    const nextNodes = { ...project.nodes };
    toRemove.forEach((id) => delete nextNodes[id]);
    const parent = nextNodes[target.parentId];
    if (parent) {
      nextNodes[target.parentId] = {
        ...parent,
        children: parent.children.filter((id) => id !== nodeId),
        updatedAt,
      };
    }

    return {
      selectedNodeId: target.parentId,
      project: {
        ...project,
        nodes: nextNodes,
        updatedAt,
      },
    };
  }

  it("rapidly deletes three independent nodes sequentially with a delayed first response and never resurrects deleted nodes", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve) => {
          deleteCalls.push({ nodeId, resolve });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const nodeA = `${initialProject.id}_a`;
    const nodeB = `${initialProject.id}_b`;
    const nodeC = `${initialProject.id}_c`;

    const observedNodeIdSets: string[][] = [];
    const unsubscribe = useBranchMindStore.subscribe((state) => {
      const active = state.projects.find((item) => item.id === initialProject.id);
      if (active) {
        observedNodeIdSets.push(Object.keys(active.nodes));
      }
    });

    // Rapidly trigger three deletions back-to-back without awaiting.
    const delA = useBranchMindStore.getState().deleteNode(nodeA);
    const delB = useBranchMindStore.getState().deleteNode(nodeB);
    const delC = useBranchMindStore.getState().deleteNode(nodeC);

    // Optimistic UI: all three nodes disappear immediately before any network response.
    const optimisticNodes = useBranchMindStore.getState().projects[0].nodes;
    expect(optimisticNodes[nodeA]).toBeUndefined();
    expect(optimisticNodes[nodeB]).toBeUndefined();
    expect(optimisticNodes[nodeC]).toBeUndefined();
    expect(useBranchMindStore.getState().creatingNodeId).toBe(nodeC);

    // Per-project serialization: only the first DELETE has been issued while delayed.
    await waitForPendingResponseCount(deleteCalls, 1);
    expect(deleteCalls.map((call) => call.nodeId)).toEqual([nodeA]);

    // Deliberately delay the first DELETE response; its server snapshot still contains B and C!
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(deleteCalls).toHaveLength(1);
    const afterA = serverDeleteSubtree(serverProject, nodeA, "2026-01-01T00:00:01.000Z");
    serverProject = afterA.project;
    expect(serverProject.nodes[nodeB]).toBeDefined();
    expect(serverProject.nodes[nodeC]).toBeDefined();
    deleteCalls[0].resolve(Response.json(afterA));

    await delA;
    await waitForPendingResponseCount(deleteCalls, 2);
    expect(deleteCalls.map((call) => call.nodeId)).toEqual([nodeA, nodeB]);
    expect(useBranchMindStore.getState().creatingNodeId).not.toBeNull();
    expect(useBranchMindStore.getState().projects[0].nodes[nodeB]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[nodeC]).toBeUndefined();

    const afterB = serverDeleteSubtree(serverProject, nodeB, "2026-01-01T00:00:02.000Z");
    serverProject = afterB.project;
    deleteCalls[1].resolve(Response.json(afterB));

    await delB;
    await waitForPendingResponseCount(deleteCalls, 3);
    expect(deleteCalls.map((call) => call.nodeId)).toEqual([nodeA, nodeB, nodeC]);
    expect(useBranchMindStore.getState().creatingNodeId).not.toBeNull();
    expect(useBranchMindStore.getState().projects[0].nodes[nodeC]).toBeUndefined();

    const afterC = serverDeleteSubtree(serverProject, nodeC, "2026-01-01T00:00:03.000Z");
    serverProject = afterC.project;
    deleteCalls[2].resolve(Response.json(afterC));

    await delC;
    unsubscribe();

    const finalProject = useBranchMindStore.getState().projects[0];
    expect(useBranchMindStore.getState().creatingNodeId).toBeNull();
    expect(useBranchMindStore.getState().aiError).toBeNull();
    expect(finalProject.nodes[nodeA]).toBeUndefined();
    expect(finalProject.nodes[nodeB]).toBeUndefined();
    expect(finalProject.nodes[nodeC]).toBeUndefined();
    expect(finalProject.nodes[`${initialProject.id}_keep`]).toBeDefined();

    // After the 3rd optimistic deletion (snapshot index >= 2), none of A, B, C ever reappeared.
    for (const snapshot of observedNodeIdSets.slice(2)) {
      expect(snapshot).not.toContain(nodeA);
      expect(snapshot).not.toContain(nodeB);
      expect(snapshot).not.toContain(nodeC);
    }
  });

  it("operates independently across different projects and handles out-of-order concurrent responses", async () => {
    const alphaInitial = makeDeletionTreeProject("alpha");
    const betaInitial = makeDeletionTreeProject("beta");
    let serverAlpha = alphaInitial;
    let serverBeta = betaInitial;
    const inFlight: Record<string, (response: Response) => void> = {};

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverAlpha, serverBeta] }));
      }
      if (init?.method === "DELETE") {
        return new Promise<Response>((resolve) => {
          inFlight[url] = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });

    // Start two sequential deletes on project alpha.
    useBranchMindStore.getState().selectProject("alpha");
    const delAlphaA = useBranchMindStore.getState().deleteNode("alpha_a");
    const delAlphaB = useBranchMindStore.getState().deleteNode("alpha_b");

    // Switch to project beta and start a delete concurrently while alpha_a is still pending.
    useBranchMindStore.getState().selectProject("beta");
    const delBetaA = useBranchMindStore.getState().deleteNode("beta_a");

    expect(Object.keys(inFlight)).toEqual([
      "/api/projects/alpha/nodes/alpha_a",
      "/api/projects/beta/nodes/beta_a",
    ]);

    // Return beta's response BEFORE alpha's first response (out-of-order across concurrent queues).
    const afterBetaA = serverDeleteSubtree(serverBeta, "beta_a", "2026-01-01T00:00:01.000Z");
    serverBeta = afterBetaA.project;
    inFlight["/api/projects/beta/nodes/beta_a"](Response.json(afterBetaA));
    await delBetaA;

    const midState = useBranchMindStore.getState();
    expect(midState.activeProjectId).toBe("beta");
    expect(midState.projects.find((p) => p.id === "beta")?.nodes.beta_a).toBeUndefined();
    expect(midState.projects.find((p) => p.id === "alpha")?.nodes.alpha_a).toBeUndefined();
    expect(midState.projects.find((p) => p.id === "alpha")?.nodes.alpha_b).toBeUndefined();
    expect(midState.creatingNodeId).not.toBeNull();

    // Now resolve alpha_a -> triggers alpha_b -> resolve alpha_b.
    const afterAlphaA = serverDeleteSubtree(
      serverAlpha,
      "alpha_a",
      "2026-01-01T00:00:02.000Z",
    );
    serverAlpha = afterAlphaA.project;
    inFlight["/api/projects/alpha/nodes/alpha_a"](Response.json(afterAlphaA));
    await delAlphaA;

    await vi.waitFor(() => {
      expect(inFlight["/api/projects/alpha/nodes/alpha_b"]).toBeDefined();
    });
    const afterAlphaB = serverDeleteSubtree(
      serverAlpha,
      "alpha_b",
      "2026-01-01T00:00:03.000Z",
    );
    serverAlpha = afterAlphaB.project;
    inFlight["/api/projects/alpha/nodes/alpha_b"](Response.json(afterAlphaB));
    await delAlphaB;

    const finalState = useBranchMindStore.getState();
    expect(finalState.creatingNodeId).toBeNull();
    expect(finalState.activeProjectId).toBe("beta");
    expect(finalState.projects.find((p) => p.id === "alpha")?.nodes.alpha_a).toBeUndefined();
    expect(finalState.projects.find((p) => p.id === "alpha")?.nodes.alpha_b).toBeUndefined();
    expect(finalState.projects.find((p) => p.id === "beta")?.nodes.beta_a).toBeUndefined();
  });

  it("recovers from a failed deletion by retrieving authoritative state and replaying pending deletions while subsequent deletions succeed", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve) => {
          deleteCalls.push({ nodeId, resolve });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const nodeA = `${initialProject.id}_a`;
    const nodeB = `${initialProject.id}_b`;
    const nodeC = `${initialProject.id}_c`;

    const observedNodeIdSets: string[][] = [];
    const unsubscribe = useBranchMindStore.subscribe((state) => {
      const active = state.projects.find((item) => item.id === initialProject.id);
      if (active) {
        observedNodeIdSets.push(Object.keys(active.nodes));
      }
    });

    // Queue A (succeeds), B (fails), C (succeeds).
    const delA = useBranchMindStore.getState().deleteNode(nodeA);
    const delB = useBranchMindStore.getState().deleteNode(nodeB);
    const delC = useBranchMindStore.getState().deleteNode(nodeC);

    await waitForPendingResponseCount(deleteCalls, 1);
    const afterA = serverDeleteSubtree(serverProject, nodeA, "2026-01-01T00:00:01.000Z");
    serverProject = afterA.project;
    deleteCalls[0].resolve(Response.json(afterA));
    await delA;

    // Fail B with a 500 error while C is still pending in the queue.
    await waitForPendingResponseCount(deleteCalls, 2);
    deleteCalls[1].resolve(
      Response.json(
        { error: { code: "INTERNAL_ERROR", message: "Failed to delete Node B" } },
        { status: 500 },
      ),
    );
    await delB;

    // Immediately after B fails (before C resolves):
    // - A must NOT come back
    // - B MUST be restored from authoritative state
    // - C MUST remain optimistically deleted (pending replay)
    const stateAfterBFailure = useBranchMindStore.getState();
    const projectAfterBFailure = stateAfterBFailure.projects[0];
    expect(projectAfterBFailure.nodes[nodeA]).toBeUndefined();
    expect(projectAfterBFailure.nodes[nodeB]).toBeDefined();
    expect(projectAfterBFailure.nodes[initialProject.rootNodeId].children).toContain(nodeB);
    expect(projectAfterBFailure.nodes[nodeC]).toBeUndefined();
    expect(projectAfterBFailure.nodes[initialProject.rootNodeId].children).not.toContain(
      nodeC,
    );
    expect(stateAfterBFailure.aiError).toBe("Failed to delete Node B");

    // Subsequent deletion C executes and succeeds.
    await waitForPendingResponseCount(deleteCalls, 3);
    const afterC = serverDeleteSubtree(serverProject, nodeC, "2026-01-01T00:00:02.000Z");
    serverProject = afterC.project;
    deleteCalls[2].resolve(Response.json(afterC));
    await delC;
    unsubscribe();

    const finalState = useBranchMindStore.getState();
    const finalProject = finalState.projects[0];
    expect(finalState.creatingNodeId).toBeNull();
    expect(finalState.aiError).toBe("Failed to delete Node B");
    expect(finalProject.nodes[nodeA]).toBeUndefined();
    expect(finalProject.nodes[nodeB]).toBeDefined();
    expect(finalProject.nodes[nodeC]).toBeUndefined();

    // Neither A nor C ever reappeared in any intermediate state after initial optimistic removal.
    for (const snapshot of observedNodeIdSets.slice(2)) {
      expect(snapshot).not.toContain(nodeA);
      expect(snapshot).not.toContain(nodeC);
    }
  });

  it("handles overlapping parent and descendant deletions and already-deleted server nodes safely", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve) => {
          deleteCalls.push({ nodeId, resolve });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const parentId = `${initialProject.id}_parent`;
    const childId = `${initialProject.id}_child`;
    const grandchildId = `${initialProject.id}_grandchild`;
    const alreadyGoneId = `${initialProject.id}_a`;

    const observedNodeIdSets: string[][] = [];
    const unsubscribe = useBranchMindStore.subscribe((state) => {
      const active = state.projects.find((item) => item.id === initialProject.id);
      if (active) {
        observedNodeIdSets.push(Object.keys(active.nodes));
      }
    });

    // Case 1: Delete parent first, then immediately delete its descendant while parent DELETE is in flight.
    const delParent = useBranchMindStore.getState().deleteNode(parentId);
    const delChild = useBranchMindStore.getState().deleteNode(childId);

    await waitForPendingResponseCount(deleteCalls, 1);
    expect(deleteCalls[0].nodeId).toBe(parentId);

    const afterParent = serverDeleteSubtree(
      serverProject,
      parentId,
      "2026-01-01T00:00:01.000Z",
    );
    serverProject = afterParent.project;
    deleteCalls[0].resolve(Response.json(afterParent));

    await Promise.all([delParent, delChild]);
    // Descendant was already cascade-deleted on the server, so no redundant DELETE child request is sent.
    expect(deleteCalls).toHaveLength(1);
    expect(useBranchMindStore.getState().aiError).toBeNull();
    expect(useBranchMindStore.getState().projects[0].nodes[parentId]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[childId]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[grandchildId]).toBeUndefined();

    // Case 2: Node was already deleted on the server out-of-band (server returns 400 NODE_CANNOT_BE_DELETED,
    // and authoritative GET /api/projects confirms it is already gone).
    serverProject = serverDeleteSubtree(
      serverProject,
      alreadyGoneId,
      "2026-01-01T00:00:02.000Z",
    ).project;

    const delAlreadyGone = useBranchMindStore.getState().deleteNode(alreadyGoneId);
    await waitForPendingResponseCount(deleteCalls, 2);
    deleteCalls[1].resolve(
      Response.json(
        { error: { code: "NODE_CANNOT_BE_DELETED", message: "Node cannot be deleted." } },
        { status: 400 },
      ),
    );
    await delAlreadyGone;
    unsubscribe();

    const finalState = useBranchMindStore.getState();
    expect(finalState.aiError).toBeNull();
    expect(finalState.creatingNodeId).toBeNull();
    expect(finalState.projects[0].nodes[alreadyGoneId]).toBeUndefined();

    for (const snapshot of observedNodeIdSets) {
      expect(snapshot).not.toContain(parentId);
      expect(snapshot).not.toContain(childId);
      expect(snapshot).not.toContain(grandchildId);
    }
  });

  it("handles deleting a descendant followed by its parent even when the descendant request fails", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve) => {
          deleteCalls.push({ nodeId, resolve });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const parentId = `${initialProject.id}_parent`;
    const childId = `${initialProject.id}_child`;

    const observedNodeIdSets: string[][] = [];
    const unsubscribe = useBranchMindStore.subscribe((state) => {
      const active = state.projects.find((item) => item.id === initialProject.id);
      if (active) {
        observedNodeIdSets.push(Object.keys(active.nodes));
      }
    });

    const delChild = useBranchMindStore.getState().deleteNode(childId);
    const delParent = useBranchMindStore.getState().deleteNode(parentId);

    await waitForPendingResponseCount(deleteCalls, 1);
    expect(deleteCalls[0].nodeId).toBe(childId);

    // Child deletion fails, while parent deletion is still pending.
    deleteCalls[0].resolve(
      Response.json(
        { error: { code: "INTERNAL_ERROR", message: "Transient failure" } },
        { status: 500 },
      ),
    );
    await delChild;

    // Replaying pending parent deletion keeps both parent and child absent without flicker.
    expect(useBranchMindStore.getState().projects[0].nodes[parentId]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[childId]).toBeUndefined();

    await waitForPendingResponseCount(deleteCalls, 2);
    expect(deleteCalls[1].nodeId).toBe(parentId);
    const afterParent = serverDeleteSubtree(
      serverProject,
      parentId,
      "2026-01-01T00:00:01.000Z",
    );
    serverProject = afterParent.project;
    deleteCalls[1].resolve(Response.json(afterParent));
    await delParent;
    unsubscribe();

    expect(useBranchMindStore.getState().projects[0].nodes[parentId]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[childId]).toBeUndefined();
    for (const snapshot of observedNodeIdSets.slice(1)) {
      expect(snapshot).not.toContain(parentId);
      expect(snapshot).not.toContain(childId);
    }
  });

  it("preserves unrelated node and project modifications across successful and failed deletions", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
    }> = [];
    const deferredPatches: Array<() => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve) => {
          deleteCalls.push({ nodeId, resolve });
        });
      }
      if (init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          deferredPatches.push(() => resolve(Response.json({ project: serverProject })));
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const nodeA = `${initialProject.id}_a`;
    const nodeB = `${initialProject.id}_b`;
    const keepId = `${initialProject.id}_keep`;

    // Start an optimistic title edit on an unrelated node before its PATCH settles.
    void useBranchMindStore.getState().updateNodeTitle(keepId, "Renamed Keep Node");

    // Rapidly delete nodeA (will succeed) and nodeB (will fail).
    const delA = useBranchMindStore.getState().deleteNode(nodeA);
    const delB = useBranchMindStore.getState().deleteNode(nodeB);

    // Perform unrelated modifications while deletions are in flight.
    useBranchMindStore.getState().selectNode(keepId);
    await useBranchMindStore.getState().updateNodePosition(keepId, { x: 777, y: 888 });
    void useBranchMindStore.getState().toggleNodeCollapsed(keepId);
    void useBranchMindStore.getState().updateProjectNotes(initialProject.id, "Unrelated notes");

    // Server returns a snapshot for DELETE A that still has the old untouched Keep node and empty notes.
    await waitForPendingResponseCount(deleteCalls, 1);
    const afterA = serverDeleteSubtree(serverProject, nodeA, "2026-01-01T00:00:01.000Z");
    serverProject = afterA.project;
    deleteCalls[0].resolve(Response.json(afterA));
    await delA;

    const midProject = useBranchMindStore.getState().projects[0];
    expect(midProject.notes).toBe("Unrelated notes");
    expect(midProject.nodes[keepId].title).toBe("Renamed Keep Node");
    expect(midProject.nodes[keepId].position).toEqual({ x: 777, y: 888 });
    expect(midProject.nodes[keepId].collapsed).toBe(true);
    expect(useBranchMindStore.getState().selectedNodeId).toBe(keepId);

    // Now fail DELETE B; authoritative GET /api/projects also still has the old Keep fields on server.
    await waitForPendingResponseCount(deleteCalls, 2);
    deleteCalls[1].resolve(
      Response.json(
        { error: { code: "INTERNAL_ERROR", message: "Delete B failed" } },
        { status: 500 },
      ),
    );
    await delB;

    const finalState = useBranchMindStore.getState();
    const finalProject = finalState.projects[0];
    expect(finalState.selectedNodeId).toBe(keepId);
    expect(finalState.creatingNodeId).toBeNull();
    expect(finalProject.nodes[nodeA]).toBeUndefined();
    expect(finalProject.nodes[nodeB]).toBeDefined();
    expect(finalProject.notes).toBe("Unrelated notes");
    expect(finalProject.nodes[keepId].title).toBe("Renamed Keep Node");
    expect(finalProject.nodes[keepId].titleManuallyEdited).toBe(true);
    expect(finalProject.nodes[keepId].position).toEqual({ x: 777, y: 888 });
    expect(finalProject.nodes[keepId].collapsed).toBe(true);
  });

  it("falls back to lastConfirmedProject and replays pending deletions when both the first DELETE and authoritative GET fail", async () => {
    const initialProject = makeDeletionTreeProject();
    let serverProject = initialProject;
    let offline = false;
    const deleteCalls: Array<{
      nodeId: string;
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        if (offline) {
          return Promise.reject(new Error("Network offline"));
        }
        return Promise.resolve(Response.json({ projects: [serverProject] }));
      }
      const prefix = `/api/projects/${initialProject.id}/nodes/`;
      if (url.startsWith(prefix) && init?.method === "DELETE") {
        const nodeId = url.slice(prefix.length);
        return new Promise<Response>((resolve, reject) => {
          deleteCalls.push({ nodeId, resolve, reject });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(initialProject.id);

    const nodeA = `${initialProject.id}_a`;
    const nodeB = `${initialProject.id}_b`;
    const nodeC = `${initialProject.id}_c`;

    const observedNodeIdSets: string[][] = [];
    const unsubscribe = useBranchMindStore.subscribe((state) => {
      const active = state.projects.find((item) => item.id === initialProject.id);
      if (active) {
        observedNodeIdSets.push(Object.keys(active.nodes));
      }
    });

    const delA = useBranchMindStore.getState().deleteNode(nodeA);
    const delB = useBranchMindStore.getState().deleteNode(nodeB);
    const delC = useBranchMindStore.getState().deleteNode(nodeC);

    await waitForPendingResponseCount(deleteCalls, 1);
    offline = true;
    deleteCalls[0].reject(new Error("Network disconnected"));
    await delA;

    // A is restored via lastConfirmedProject fallback, while B and C remain deleted via pending replay.
    expect(useBranchMindStore.getState().projects[0].nodes[nodeA]).toBeDefined();
    expect(useBranchMindStore.getState().projects[0].nodes[nodeB]).toBeUndefined();
    expect(useBranchMindStore.getState().projects[0].nodes[nodeC]).toBeUndefined();
    expect(useBranchMindStore.getState().aiError).toBe("Network disconnected");

    // Connectivity recovers; subsequent deletions B and C succeed.
    offline = false;
    await waitForPendingResponseCount(deleteCalls, 2);
    const afterB = serverDeleteSubtree(serverProject, nodeB, "2026-01-01T00:00:01.000Z");
    serverProject = afterB.project;
    deleteCalls[1].resolve(Response.json(afterB));
    await delB;

    await waitForPendingResponseCount(deleteCalls, 3);
    const afterC = serverDeleteSubtree(serverProject, nodeC, "2026-01-01T00:00:02.000Z");
    serverProject = afterC.project;
    deleteCalls[2].resolve(Response.json(afterC));
    await delC;
    unsubscribe();

    const finalProject = useBranchMindStore.getState().projects[0];
    expect(useBranchMindStore.getState().creatingNodeId).toBeNull();
    expect(finalProject.nodes[nodeA]).toBeDefined();
    expect(finalProject.nodes[nodeB]).toBeUndefined();
    expect(finalProject.nodes[nodeC]).toBeUndefined();

    for (const snapshot of observedNodeIdSets.slice(2)) {
      expect(snapshot).not.toContain(nodeB);
      expect(snapshot).not.toContain(nodeC);
    }
  });
});

describe("useBranchMindStore node title updates", () => {
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

  function makeTitleUpdateFetchMock(
    project: Project,
    capturePatchResolve: (resolve: (response: Response) => void) => void,
  ) {
    const rootId = project.rootNodeId;
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (url === `/api/projects/${project.id}/nodes/${rootId}` && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          capturePatchResolve(resolve);
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
  }

  it("keeps a manually renamed project title when the root node title changes", async () => {
    const project = makeRegenerateProject();
    const rootId = project.rootNodeId;
    const serverProject: Project = {
      ...project,
      nodes: {
        ...project.nodes,
        [rootId]: {
          ...project.nodes[rootId],
          title: "Renamed root",
          titleManuallyEdited: true,
        },
      },
    };
    let resolvePatch: (response: Response) => void = () => {};
    const fetchMock = makeTitleUpdateFetchMock(project, (resolve) => {
      resolvePatch = resolve;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const update = useBranchMindStore.getState().updateNodeTitle(rootId, "Renamed root");

    const optimisticProject = useBranchMindStore
      .getState()
      .projects.find((item) => item.id === project.id);
    expect(optimisticProject?.title).toBe("Regenerate test project");
    expect(optimisticProject?.nodes[rootId].title).toBe("Renamed root");

    resolvePatch(Response.json({ project: serverProject }));
    await expect(update).resolves.toBe(true);

    const savedProject = useBranchMindStore
      .getState()
      .projects.find((item) => item.id === project.id);
    expect(savedProject?.title).toBe("Regenerate test project");
    expect(savedProject?.nodes[rootId].title).toBe("Renamed root");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${project.id}/nodes/${rootId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed root" }),
      }),
    );
  });

  it("syncs the project title while it matches the previous root title", async () => {
    const project: Project = { ...makeRegenerateProject(), title: "Root" };
    const rootId = project.rootNodeId;
    const serverProject: Project = {
      ...project,
      title: "Renamed root",
      nodes: {
        ...project.nodes,
        [rootId]: {
          ...project.nodes[rootId],
          title: "Renamed root",
          titleManuallyEdited: true,
        },
      },
    };
    let resolvePatch: (response: Response) => void = () => {};
    const fetchMock = makeTitleUpdateFetchMock(project, (resolve) => {
      resolvePatch = resolve;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const update = useBranchMindStore.getState().updateNodeTitle(rootId, "Renamed root");

    const optimisticProject = useBranchMindStore
      .getState()
      .projects.find((item) => item.id === project.id);
    expect(optimisticProject?.title).toBe("Renamed root");
    expect(optimisticProject?.nodes[rootId].title).toBe("Renamed root");

    resolvePatch(Response.json({ project: serverProject }));
    await expect(update).resolves.toBe(true);

    const savedProject = useBranchMindStore
      .getState()
      .projects.find((item) => item.id === project.id);
    expect(savedProject?.title).toBe("Renamed root");
    expect(savedProject?.nodes[rootId].title).toBe("Renamed root");
  });
});

describe("useBranchMindStore node collapse", () => {
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

  it("updates immediately and serializes rapid collapse toggles", async () => {
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    const collapsedProject: Project = {
      ...project,
      nodes: {
        ...project.nodes,
        [nodeId]: { ...project.nodes[nodeId], collapsed: true },
      },
    };
    const expandedProject: Project = {
      ...project,
      nodes: {
        ...project.nodes,
        [nodeId]: { ...project.nodes[nodeId], collapsed: false },
      },
    };
    const pendingResponses: Array<{ resolve: (response: Response) => void }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (url === `/api/projects/${project.id}/nodes/${nodeId}` && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          pendingResponses.push({ resolve });
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const firstToggle = useBranchMindStore.getState().toggleNodeCollapsed(nodeId);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(true);
    await waitForPendingResponseCount(pendingResponses, 1);

    const secondToggle = useBranchMindStore.getState().toggleNodeCollapsed(nodeId);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(false);

    pendingResponses[0].resolve(Response.json({ project: collapsedProject }));
    await waitForPendingResponseCount(pendingResponses, 2);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(false);

    pendingResponses[1].resolve(Response.json({ project: expandedProject }));
    await Promise.all([firstToggle, secondToggle]);

    const patchBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(patchBodies).toEqual([{ collapsed: true }, { collapsed: false }]);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(false);
  });

  it("rolls back the optimistic update when saving it fails", async () => {
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (url === `/api/projects/${project.id}/nodes/${nodeId}` && init?.method === "PATCH") {
        return Promise.reject(new Error("Could not save collapse state"));
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const toggle = useBranchMindStore.getState().toggleNodeCollapsed(nodeId);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(true);

    await toggle;
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].collapsed).toBe(false);
    expect(useBranchMindStore.getState().aiError).toBe("Could not save collapse state");
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
    // The project title was renamed manually, so the optimistic draft keeps it.
    expect(draft.title).toBe("Regenerate test project");
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

describe("useBranchMindStore appendNodeMessage", () => {
  let localStorage: MemoryStorage;
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let requestAnimationFrameMock: ReturnType<typeof vi.fn>;
  let cancelAnimationFrameMock: ReturnType<typeof vi.fn>;

  function flushAnimationFrames() {
    const callbacks = Array.from(rafQueue.values());
    rafQueue.clear();
    callbacks.forEach((callback) => callback(16));
  }

  beforeEach(() => {
    vi.resetModules();
    localStorage = new MemoryStorage();
    rafQueue = new Map();
    nextRafId = 1;
    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId;
      nextRafId += 1;
      rafQueue.set(id, callback);
      return id;
    });
    cancelAnimationFrameMock = vi.fn((id: number) => {
      rafQueue.delete(id);
    });
    vi.stubGlobal("window", {
      localStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: requestAnimationFrameMock,
      cancelAnimationFrame: cancelAnimationFrameMock,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams an in-node follow-up with optimistic user+assistant messages, preserves title while streaming, batches deltas, and finalizes node on complete", async () => {
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${nodeId}/messages/stream` &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const attachment: ChatAttachment = {
      id: "att_followup",
      name: "notes.pdf",
      mimeType: "application/pdf",
      size: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "doc_followup",
      documentStatus: "indexed",
    };
    const modelSelection: ChatModelSelection = {
      providerId: "deepseek",
      model: "deepseek-chat",
    };
    const skill: ChatSkill = {
      id: "skill_1",
      name: "Socratic",
      description: "Ask probing questions",
      instructions: "Guide step by step",
      version: "1.0.0",
    };

    const started = await useBranchMindStore
      .getState()
      .appendNodeMessage(
        nodeId,
        "  Can you give a concrete example?  ",
        "Second answer snippet",
        [attachment],
        modelSelection,
        skill,
      );
    expect(started).toBe(true);

    const optimisticState = useBranchMindStore.getState();
    const optimisticProject = optimisticState.projects[0];
    const optimisticNode = optimisticProject.nodes[nodeId];

    // Does not spawn a child node; preserves title & summary while streaming.
    expect(Object.keys(optimisticProject.nodes)).toEqual([
      nodeId,
      "project_regenerate_child",
    ]);
    expect(optimisticNode.children).toEqual(["project_regenerate_child"]);
    expect(optimisticNode.title).toBe("Root");
    expect(optimisticNode.titleManuallyEdited).toBe(false);
    expect(optimisticNode.summary).toBe("Summary");
    expect(optimisticNode.messages).toHaveLength(6);
    expect(optimisticNode.messages[4]).toMatchObject({
      role: "user",
      content: "Can you give a concrete example?",
      attachments: [attachment],
    });
    expect(optimisticNode.messages[5]).toMatchObject({
      id: optimisticState.streamingMessageId,
      role: "assistant",
      content: "",
      attachments: [],
    });
    expect(optimisticState.selectedNodeId).toBe(nodeId);
    expect(optimisticState.creatingNodeId).toBe(nodeId);
    expect(optimisticState.streamingNodeId).toBe(nodeId);
    expect(optimisticState.aiError).toBeNull();

    // Verify request contract.
    const streamCall = fetchMock.mock.calls.find(([input]) =>
      input.toString().endsWith(`/nodes/${nodeId}/messages/stream`),
    );
    expect(streamCall).toBeDefined();
    expect(streamCall?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(streamCall?.[1]?.body))).toEqual({
      instruction: "Can you give a concrete example?",
      sourceText: "Second answer snippet",
      attachments: [attachment],
      expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
      modelSelection,
      skill,
    });

    // Wait for stream reader to attach and push two deltas in one chunk to verify batching.
    await vi.waitFor(() => {
      expect(streamController).not.toBeNull();
    });
    streamController!.enqueue(
      encoder.encode(
        `event: delta\ndata: ${JSON.stringify({ contentDelta: "Here is " })}\n\nevent: delta\ndata: ${JSON.stringify({ contentDelta: "an example." })}\n\n`,
      ),
    );

    await vi.waitFor(() => {
      expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    });
    // Before animation frame flushes, draft message is still empty.
    expect(
      useBranchMindStore.getState().projects[0].nodes[nodeId].messages[5].content,
    ).toBe("");

    flushAnimationFrames();
    const midStreamNode = useBranchMindStore.getState().projects[0].nodes[nodeId];
    expect(midStreamNode.messages[5].content).toBe("Here is an example.");
    expect(midStreamNode.title).toBe("Root");
    expect(midStreamNode.summary).toBe("Summary");
    expect(useBranchMindStore.getState().streamingNodeId).toBe(nodeId);

    // Concurrent edits on project notes and sibling/child node position while streaming.
    useBranchMindStore.setState((state) => ({
      projects: state.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              notes: "Concurrent notes during follow-up",
              updatedAt: "2026-01-05T00:00:00.000Z",
              nodes: {
                ...item.nodes,
                project_regenerate_child: {
                  ...item.nodes.project_regenerate_child,
                  position: { x: 42, y: 84 },
                },
              },
            }
          : item,
      ),
    }));

    const serverNode = {
      ...project.nodes[nodeId],
      title: "Root",
      summary: "Updated summary covering concrete example",
      messages: [
        ...project.nodes[nodeId].messages,
        {
          id: "server_user_c",
          role: "user" as const,
          content: "Can you give a concrete example?",
          attachments: [attachment],
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "server_assistant_c",
          role: "assistant" as const,
          content: "Here is an example with full details.",
          attachments: [],
          createdAt: "2026-01-02T00:00:01.000Z",
        },
      ],
      updatedAt: "2026-01-02T00:00:01.000Z",
    };
    const serverProject: Project = {
      ...project,
      updatedAt: "2026-01-02T00:00:01.000Z",
      nodes: {
        ...project.nodes,
        [nodeId]: serverNode,
      },
    };

    streamController!.enqueue(
      encoder.encode(
        `event: complete\ndata: ${JSON.stringify({ project: serverProject, node: serverNode })}\n\n`,
      ),
    );
    streamController!.close();

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });

    const finalState = useBranchMindStore.getState();
    const finalProject = finalState.projects[0];
    expect(finalState.creatingNodeId).toBeNull();
    expect(finalState.streamingMessageId).toBeNull();
    expect(finalState.selectedNodeId).toBe(nodeId);
    expect(finalState.aiError).toBeNull();
    expect(finalProject.notes).toBe("Concurrent notes during follow-up");
    expect(finalProject.updatedAt).toBe("2026-01-05T00:00:00.000Z");
    expect(finalProject.nodes.project_regenerate_child.position).toEqual({ x: 42, y: 84 });
    expect(finalProject.nodes[nodeId].title).toBe("Root");
    expect(finalProject.nodes[nodeId].summary).toBe(
      "Updated summary covering concrete example",
    );
    expect(
      finalProject.nodes[nodeId].messages.map((message) => [message.id, message.content]),
    ).toEqual([
      ["user_a", "First prompt"],
      ["assistant_a", "First answer"],
      ["user_b", "Second prompt"],
      ["assistant_b", "Second answer"],
      ["server_user_c", "Can you give a concrete example?"],
      ["server_assistant_c", "Here is an example with full details."],
    ]);
  });

  it("rolls back optimistic appended messages and restores updatedAt on HTTP or stream error while preserving concurrent updates", async () => {
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    let resolveStream: (response: Response) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${nodeId}/messages/stream` &&
        init?.method === "POST"
      ) {
        return new Promise<Response>((resolve) => {
          resolveStream = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    const started = await useBranchMindStore
      .getState()
      .appendNodeMessage(nodeId, "Follow-up that will fail");
    expect(started).toBe(true);
    expect(useBranchMindStore.getState().projects[0].nodes[nodeId].messages).toHaveLength(6);

    // Concurrent position update while request is in flight.
    useBranchMindStore.setState((state) => ({
      projects: state.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              nodes: {
                ...item.nodes,
                project_regenerate_child: {
                  ...item.nodes.project_regenerate_child,
                  position: { x: 99, y: 99 },
                },
              },
            }
          : item,
      ),
    }));

    resolveStream(
      Response.json(
        { error: { code: "UPSTREAM_FAILED", message: "Provider unavailable" } },
        { status: 502 },
      ),
    );

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });

    const rolledBackState = useBranchMindStore.getState();
    const rolledBackNode = rolledBackState.projects[0].nodes[nodeId];
    expect(rolledBackState.creatingNodeId).toBeNull();
    expect(rolledBackState.streamingMessageId).toBeNull();
    expect(rolledBackState.selectedNodeId).toBe(nodeId);
    expect(rolledBackState.aiError).toBe("Provider unavailable");
    expect(rolledBackNode.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rolledBackNode.messages.map((message) => message.id)).toEqual([
      "user_a",
      "assistant_a",
      "user_b",
      "assistant_b",
    ]);
    expect(rolledBackState.projects[0].nodes.project_regenerate_child.position).toEqual({
      x: 99,
      y: 99,
    });
  });

  it("rolls back optimistic appended messages when an SSE stream ends without a complete event", async () => {
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${nodeId}/messages/stream` &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          new Response(`event: delta\ndata: ${JSON.stringify({ contentDelta: "Partial" })}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    await expect(
      useBranchMindStore.getState().appendNodeMessage(nodeId, "Prematurely closed stream"),
    ).resolves.toBe(true);

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });

    const state = useBranchMindStore.getState();
    expect(cancelAnimationFrameMock).toHaveBeenCalled();
    expect(state.aiError).toBe("Streaming response ended before completion.");
    expect(state.projects[0].nodes[nodeId].messages).toHaveLength(4);
    expect(state.projects[0].nodes[nodeId].updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("surfaces the localized regenerateConflict message on 409 NODE_CONFLICT", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    const project = makeRegenerateProject();
    const nodeId = project.rootNodeId;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${nodeId}/messages/stream` &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: "NODE_CONFLICT",
                message: "Node was updated elsewhere.",
              },
            },
            { status: 409 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    await expect(
      useBranchMindStore.getState().appendNodeMessage(nodeId, "Conflicting follow-up"),
    ).resolves.toBe(true);

    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });

    const state = useBranchMindStore.getState();
    expect(state.aiError).toBe(LANGUAGE_COPY.en.workspace.regenerateConflict);
    expect(state.projects[0].nodes[nodeId].messages).toHaveLength(4);
    expect(state.projects[0].nodes[nodeId].updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects blank nodes, empty instructions, unsynced projects, and concurrent streams", async () => {
    const baseProject = makeRegenerateProject();
    const blankNodeId = "blank_child_node";
    const project: Project = {
      ...baseProject,
      nodes: {
        ...baseProject.nodes,
        [baseProject.rootNodeId]: {
          ...baseProject.nodes[baseProject.rootNodeId],
          children: [...baseProject.nodes[baseProject.rootNodeId].children, blankNodeId],
        },
        [blankNodeId]: {
          ...baseProject.nodes.project_regenerate_child,
          id: blankNodeId,
          messages: [],
        },
      },
    };

    let resolveFirstStream: (response: Response) => void = () => {};
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/projects" && !init?.method) {
        return Promise.resolve(Response.json({ projects: [project] }));
      }
      if (
        url === `/api/projects/${project.id}/nodes/${project.rootNodeId}/messages/stream` &&
        init?.method === "POST"
      ) {
        return new Promise<Response>((resolve) => {
          resolveFirstStream = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });
    useBranchMindStore.getState().selectProject(project.id);

    // Rejects blank node (messages.length === 0)
    await expect(
      useBranchMindStore.getState().appendNodeMessage(blankNodeId, "First prompt in blank node"),
    ).resolves.toBe(false);
    expect(useBranchMindStore.getState().projects[0].nodes[blankNodeId].messages).toEqual([]);

    // Rejects whitespace-only instruction
    await expect(
      useBranchMindStore.getState().appendNodeMessage(project.rootNodeId, "   "),
    ).resolves.toBe(false);

    // Rejects project waiting for sync
    useBranchMindStore.setState((state) => ({
      pendingProjectSyncs: {
        ...state.pendingProjectSyncs,
        [project.id]: {
          project,
          nodeId: project.rootNodeId,
          assistantMessageId: "assistant_b",
          status: "syncing",
          error: null,
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      },
    }));
    await expect(
      useBranchMindStore.getState().appendNodeMessage(project.rootNodeId, "Blocked by sync"),
    ).resolves.toBe(false);
    useBranchMindStore.setState({ pendingProjectSyncs: {} });

    // No stream calls should have been issued yet
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Start one valid stream, then verify concurrent appendNodeMessage is rejected
    await expect(
      useBranchMindStore.getState().appendNodeMessage(project.rootNodeId, "First follow-up"),
    ).resolves.toBe(true);
    await expect(
      useBranchMindStore.getState().appendNodeMessage(project.rootNodeId, "Concurrent follow-up"),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Finish first stream cleanly
    resolveFirstStream(
      Response.json({ error: "Aborted in test" }, { status: 500 }),
    );
    await vi.waitFor(() => {
      expect(useBranchMindStore.getState().streamingNodeId).toBeNull();
    });
  });
});

describe("useBranchMindStore with unavailable browser storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      visibilityState: "visible",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hydrates projects from the server when storage access is blocked", async () => {
    stubBlockedStorageWindow();
    const project = makeProject("project_blocked_storage");
    const fetchMock = vi.fn(async () => Response.json({ projects: [project] }));
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects");
    expect(useBranchMindStore.getState().aiError).toBeNull();
    expect(useBranchMindStore.getState().projects.map((item) => item.id)).toEqual([project.id]);
    expect(useBranchMindStore.getState().pendingProjectSyncs).toEqual({});
  });

  it("imports legacy projects even when clearing them from storage fails", async () => {
    const legacyProject = makeProject("project_legacy");
    stubStorageWindow(
      new ReadOnlyStorage({
        "branchmind.projects.v1": JSON.stringify([legacyProject]),
        "branchmind.activeProjectId.v1": legacyProject.id,
      }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === "/api/projects/import" && init?.method === "POST") {
        return Response.json({ projects: [legacyProject] });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${input.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useBranchMindStore } = await import("@/store/useBranchMindStore");
    await useBranchMindStore.getState().hydrate({ force: true });

    expect(useBranchMindStore.getState().aiError).toBeNull();
    expect(useBranchMindStore.getState().activeProjectId).toBe(legacyProject.id);
  });

  it("reads empty legacy/pending data and ignores writes when storage access is blocked", async () => {
    stubBlockedStorageWindow();
    const { clearLegacyProjects, readLegacyProjects } = await import("@/store/branchmind/helpers");
    const { readPendingNodePositionSyncRecords, writePendingNodePositionSyncRecords } = await import(
      "@/store/branchmind/sync"
    );

    expect(readLegacyProjects()).toEqual({ projects: [], activeProjectId: null });
    expect(() => clearLegacyProjects()).not.toThrow();
    expect(readPendingNodePositionSyncRecords()).toEqual([]);
    expect(() => writePendingNodePositionSyncRecords([])).not.toThrow();
  });

  it("ignores pending node position write failures such as an exceeded quota", async () => {
    stubStorageWindow(new ReadOnlyStorage());
    const { writePendingNodePositionSyncRecords } = await import("@/store/branchmind/sync");

    expect(() => writePendingNodePositionSyncRecords([])).not.toThrow();
  });
});
