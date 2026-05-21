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
