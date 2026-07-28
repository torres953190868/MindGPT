import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingRootProject } from "@/lib/server/project-model";
import type { Project } from "@/lib/types";

const readProjectsMock = vi.hoisted(() => vi.fn());
const saveProjectMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "owner_sync", email: null, authMode: "local" },
    session: { id: "owner_sync", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/projects-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/projects-repository")>();

  return {
    ...actual,
    getProjectsRepository: vi.fn(() => ({
      readProjects: readProjectsMock,
      saveProject: saveProjectMock,
    })),
  };
});

function makeSyncProject() {
  return createPendingRootProject("Sync this project").project;
}

function syncRequest(project: Project) {
  return new NextRequest(`http://localhost/api/projects/${project.id}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify({ project }),
  });
}

async function postSync(projectId: string, project: Project) {
  const { POST } = await import("@/app/api/projects/[projectId]/sync/route");
  return POST(syncRequest({ ...project, id: projectId }), {
    params: Promise.resolve({ projectId }),
  });
}

describe("project sync route", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    saveProjectMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    readProjectsMock.mockResolvedValue([]);
    saveProjectMock.mockResolvedValue(undefined);
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("saves a client-created project for the current owner without rewriting IDs", async () => {
    const project = {
      ...makeSyncProject(),
      ownerSessionId: "attacker_owner",
    };

    const response = await postSync(project.id, project);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.project).toMatchObject({
      id: project.id,
      rootNodeId: project.rootNodeId,
    });
    expect(saveProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: project.id,
        ownerSessionId: "owner_sync",
        rootNodeId: project.rootNodeId,
      }),
    );
  });

  it("rejects a route/project ID mismatch", async () => {
    const project = makeSyncProject();
    const { POST } = await import("@/app/api/projects/[projectId]/sync/route");

    const response = await POST(syncRequest(project), {
      params: Promise.resolve({ projectId: "project_different" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("PROJECT_ID_MISMATCH");
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("rejects a project with a missing root node", async () => {
    const project = makeSyncProject();
    const response = await postSync(project.id, {
      ...project,
      rootNodeId: "node_missing",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("PROJECT_ROOT_MISSING");
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("rejects nodes that point at a different project", async () => {
    const project = makeSyncProject();
    const root = project.nodes[project.rootNodeId];
    const response = await postSync(project.id, {
      ...project,
      nodes: {
        ...project.nodes,
        [project.rootNodeId]: {
          ...root,
          projectId: "project_other",
        },
      },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("PROJECT_NODE_INVALID");
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("rejects syncing over a project owned by someone else", async () => {
    const project = makeSyncProject();
    readProjectsMock.mockResolvedValue([{ ...project, ownerSessionId: "owner_other" }]);

    const response = await postSync(project.id, project);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PROJECT_OWNER_MISMATCH");
    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});
