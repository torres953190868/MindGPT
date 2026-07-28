import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";

const updateProjectForOwnerMock = vi.hoisted(() => vi.fn());
const deleteProjectForOwnerMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "owner_project", email: null, authMode: "local" },
    session: { id: "owner_project", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/projects-service", () => ({
  deleteProjectForOwner: deleteProjectForOwnerMock,
  updateProjectForOwner: updateProjectForOwnerMock,
}));

const project: Project = {
  id: "project_route",
  title: "Renamed project",
  notes: "",
  rootNodeId: "node_route",
  nodes: {
    node_route: {
      id: "node_route",
      projectId: "project_route",
      parentId: null,
      title: "Generated root title",
      titleManuallyEdited: false,
      summary: "Route summary",
      messages: [],
      children: [],
      position: { x: 0, y: 0 },
      branchType: "root",
      collapsed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/projects/project_route", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("project route", () => {
  beforeEach(() => {
    updateProjectForOwnerMock.mockReset();
    deleteProjectForOwnerMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    updateProjectForOwnerMock.mockResolvedValue(project);
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("patches a project title", async () => {
    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    const response = await PATCH(patchRequest({ title: "  Renamed project  " }), {
      params: Promise.resolve({ projectId: "project_route" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.project.title).toBe("Renamed project");
    expect(updateProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_project",
      "project_route",
      { title: "Renamed project" },
    );
  });

  it("rejects blank project titles", async () => {
    const { PATCH } = await import("@/app/api/projects/[projectId]/route");
    const response = await PATCH(patchRequest({ title: "   " }), {
      params: Promise.resolve({ projectId: "project_route" }),
    });

    expect(response.status).toBe(400);
    expect(updateProjectForOwnerMock).not.toHaveBeenCalled();
  });
});
