import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment, Project } from "@/lib/types";

const readProjectsMock = vi.hoisted(() => vi.fn());
const readProjectsForSessionMock = vi.hoisted(() => vi.fn());
const deleteProjectMock = vi.hoisted(() => vi.fn());
const saveProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/projects-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/projects-repository")>();

  return {
    ...actual,
    getProjectsRepository: vi.fn(() => ({
      readProjects: readProjectsMock,
      readProjectsForSession: readProjectsForSessionMock,
      deleteProject: deleteProjectMock,
      saveProject: saveProjectMock,
    })),
  };
});

import {
  deleteProjectForOwner,
  prepareRegenerateNodeContext,
  syncProjectForOwner,
  updateNodeForOwner,
} from "@/lib/server/projects-service";

const attachmentA: ChatAttachment = {
  id: "attachment-a",
  name: "a.pdf",
  mimeType: "application/pdf",
  size: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  documentId: "doc_a",
  documentStatus: "indexed",
};

const attachmentB: ChatAttachment = {
  id: "attachment-b",
  name: "b.pdf",
  mimeType: "application/pdf",
  size: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  documentId: "doc_b",
  documentStatus: "indexed",
};

function makeProject(): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";

  return {
    id: "project_regenerate",
    ownerSessionId: "owner_regenerate",
    title: "Regenerate project",
    notes: "",
    rootNodeId: "node_regenerate",
    nodes: {
      node_regenerate: {
        id: "node_regenerate",
        projectId: "project_regenerate",
        parentId: null,
        title: "Regenerate node",
        titleManuallyEdited: false,
        summary: "Regenerate summary",
        messages: [
          {
            id: "user_a",
            role: "user",
            content: "First prompt",
            attachments: [attachmentA],
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
            attachments: [attachmentB],
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
        children: [],
        position: { x: 120, y: 120 },
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

function makeSyncProject(): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";

  return {
    id: "project_sync",
    title: "Sync project",
    notes: "",
    rootNodeId: "node_sync_root",
    nodes: {
      node_sync_root: {
        id: "node_sync_root",
        projectId: "project_sync",
        parentId: null,
        title: "Sync root",
        titleManuallyEdited: false,
        summary: "Sync summary",
        messages: [
          {
            id: "user_sync",
            role: "user",
            content: "Sync prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_sync",
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

describe("prepareRegenerateNodeContext", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
  });

  it("keeps the edited user message attachments for regenerate RAG", async () => {
    const context = await prepareRegenerateNodeContext(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        instruction: "Edited first prompt",
        userMessageId: "user_a",
      },
    );

    expect(context.instruction).toBe("Edited first prompt");
    expect(context.attachments).toEqual([attachmentA]);
  });

  it("uses the nearest preceding user message attachments when retrying an assistant reply", async () => {
    const context = await prepareRegenerateNodeContext(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        assistantMessageId: "assistant_b",
      },
    );

    expect(context.instruction).toBe("Second prompt");
    expect(context.attachments).toEqual([attachmentB]);
  });
});

describe("deleteProjectForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
  });

  it("deletes owned projects and returns the refreshed owner list", async () => {
    readProjectsMock.mockResolvedValue([makeProject()]);

    await expect(
      deleteProjectForOwner("owner_regenerate", "project_regenerate"),
    ).resolves.toEqual([]);

    expect(deleteProjectMock).toHaveBeenCalledWith("project_regenerate");
    expect(readProjectsForSessionMock).toHaveBeenCalledWith("owner_regenerate");
  });

  it("treats missing or stale project deletes as idempotent", async () => {
    readProjectsMock.mockResolvedValue([]);

    await expect(
      deleteProjectForOwner("owner_regenerate", "project_regenerate"),
    ).resolves.toEqual([]);

    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(readProjectsForSessionMock).toHaveBeenCalledWith("owner_regenerate");
  });
});

describe("updateNodeForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    saveProjectMock.mockResolvedValue(undefined);
  });

  it("manually updates root node titles and syncs the project title", async () => {
    const result = await updateNodeForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      { title: "  Manual root title  " },
    );

    expect(result.title).toBe("Manual root title");
    expect(result.nodes.node_regenerate).toMatchObject({
      title: "Manual root title",
      titleManuallyEdited: true,
    });
    expect(saveProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSessionId: "owner_regenerate",
        title: "Manual root title",
      }),
    );
  });
});

describe("syncProjectForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    readProjectsMock.mockResolvedValue([]);
    saveProjectMock.mockResolvedValue(undefined);
  });

  it("rejects synced projects when node messages are missing", async () => {
    const project = makeSyncProject();
    project.nodes[project.rootNodeId].messages = [];

    await expect(
      syncProjectForOwner("owner_sync", project.id, project),
    ).rejects.toMatchObject({
      code: "PROJECT_NODE_MESSAGES_MISSING",
      status: 400,
    });

    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});
