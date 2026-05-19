import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";

const updateNodeForOwnerMock = vi.hoisted(() => vi.fn());
const deleteNodeForOwnerMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "owner_node", email: null, authMode: "local" },
    session: { id: "owner_node", isNew: false },
  })),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/projects-service", () => ({
  deleteNodeForOwner: deleteNodeForOwnerMock,
  updateNodeForOwner: updateNodeForOwnerMock,
}));

const project: Project = {
  id: "project_node_route",
  title: "Manual node title",
  notes: "",
  rootNodeId: "node_route",
  nodes: {
    node_route: {
      id: "node_route",
      projectId: "project_node_route",
      parentId: null,
      title: "Manual node title",
      titleManuallyEdited: true,
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
  return new NextRequest(
    "http://localhost/api/projects/project_node_route/nodes/node_route",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("node route", () => {
  beforeEach(() => {
    updateNodeForOwnerMock.mockReset();
    deleteNodeForOwnerMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    updateNodeForOwnerMock.mockResolvedValue(project);
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("patches a manually edited node title", async () => {
    const { PATCH } = await import("@/app/api/projects/[projectId]/nodes/[nodeId]/route");
    const response = await PATCH(patchRequest({ title: "  Manual node title  " }), {
      params: Promise.resolve({
        projectId: "project_node_route",
        nodeId: "node_route",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.project.title).toBe("Manual node title");
    expect(updateNodeForOwnerMock).toHaveBeenCalledWith(
      "owner_node",
      "project_node_route",
      "node_route",
      { title: "Manual node title" },
    );
  });

  it("rejects blank node titles", async () => {
    const { PATCH } = await import("@/app/api/projects/[projectId]/nodes/[nodeId]/route");
    const response = await PATCH(patchRequest({ title: "   " }), {
      params: Promise.resolve({
        projectId: "project_node_route",
        nodeId: "node_route",
      }),
    });

    expect(response.status).toBe(400);
    expect(updateNodeForOwnerMock).not.toHaveBeenCalled();
  });
});
