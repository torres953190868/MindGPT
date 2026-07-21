import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment, Project } from "@/lib/types";

const readProjectsMock = vi.hoisted(() => vi.fn());
const readProjectsForSessionMock = vi.hoisted(() => vi.fn());
const deleteProjectMock = vi.hoisted(() => vi.fn());
const saveProjectMock = vi.hoisted(() => vi.fn());
const updateNodePositionForOwnerMock = vi.hoisted(() => vi.fn());

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
      updateNodePositionForOwner: updateNodePositionForOwnerMock,
    })),
  };
});

import {
  deleteProjectForOwner,
  prepareChildContext,
  prepareRegenerateNodeContext,
  regenerateNodeForOwner,
  syncProjectForOwner,
  updateProjectForOwner,
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

function makeInheritedProject(): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";

  return {
    id: "project_inherit",
    ownerSessionId: "owner_inherit",
    title: "Inherited project",
    notes: "",
    rootNodeId: "node_root_inherit",
    nodes: {
      node_root_inherit: {
        id: "node_root_inherit",
        projectId: "project_inherit",
        parentId: null,
        title: "Root title",
        titleManuallyEdited: false,
        summary: "Root summary",
        messages: [
          {
            id: "user_root_inherit",
            role: "user",
            content: "Root prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_root_inherit",
            role: "assistant",
            content: "Root answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: ["node_parent_inherit"],
        position: { x: 120, y: 120 },
        branchType: "root",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      node_parent_inherit: {
        id: "node_parent_inherit",
        projectId: "project_inherit",
        parentId: "node_root_inherit",
        title: "Parent title",
        titleManuallyEdited: false,
        summary: "Parent summary",
        messages: [
          {
            id: "user_parent_inherit",
            role: "user",
            content: "Parent prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_parent_inherit",
            role: "assistant",
            content: "Parent answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: ["node_child_inherit"],
        position: { x: 120, y: 410 },
        branchType: "continue",
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      node_child_inherit: {
        id: "node_child_inherit",
        projectId: "project_inherit",
        parentId: "node_parent_inherit",
        title: "Child title",
        titleManuallyEdited: false,
        summary: "Child summary",
        messages: [
          {
            id: "user_child_inherit",
            role: "user",
            content: "Child prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_child_inherit",
            role: "assistant",
            content: "Child answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
        children: [],
        position: { x: 510, y: 410 },
        branchType: "branch",
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
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
  });

  it("keeps the edited user message attachments for regenerate RAG", async () => {
    const context = await prepareRegenerateNodeContext(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        instruction: "Edited second prompt",
        userMessageId: "user_b",
      },
    );

    expect(context.instruction).toBe("Edited second prompt");
    expect(context.attachments).toEqual([attachmentB]);
    expect(context.messages.map((message) => message.content)).toEqual([
      "First prompt",
      "First answer",
    ]);
  });

  it("rejects edits and retries outside the latest turn", async () => {
    await expect(
      prepareRegenerateNodeContext(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          instruction: "Edited first prompt",
          userMessageId: "user_a",
        },
      ),
    ).rejects.toMatchObject({
      code: "REGENERATE_NOT_LATEST",
      status: 400,
    });

    await expect(
      prepareRegenerateNodeContext(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          assistantMessageId: "assistant_a",
        },
      ),
    ).rejects.toMatchObject({
      code: "REGENERATE_NOT_LATEST",
      status: 400,
    });
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
    expect(context.messages.map((message) => message.content)).toEqual([
      "First prompt",
      "First answer",
    ]);
  });

  it("rejects explicit regenerate targets from different turns", async () => {
    await expect(
      prepareRegenerateNodeContext(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          instruction: "Edited first prompt",
          userMessageId: "user_a",
          assistantMessageId: "assistant_b",
        },
      ),
    ).rejects.toMatchObject({
      code: "REGENERATE_TARGET_MISMATCH",
      status: 400,
    });
  });
});

describe("regenerateNodeForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
  });

  const reply = {
    title: "Regenerated title",
    summary: "Regenerated summary",
    content: "Regenerated answer",
  };

  it("saves the regenerated latest turn when the expected version matches", async () => {
    const result = await regenerateNodeForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        assistantMessageId: "assistant_b",
        expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
        reply,
      },
    );

    expect(result.node.messages.at(-1)).toMatchObject({
      id: "assistant_b",
      content: "Regenerated answer",
    });
    expect(saveProjectMock).toHaveBeenCalled();
  });

  it("rejects regeneration when the node changed during generation", async () => {
    await expect(
      regenerateNodeForOwner(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          assistantMessageId: "assistant_b",
          expectedNodeUpdatedAt: "2025-12-31T00:00:00.000Z",
          reply,
        },
      ),
    ).rejects.toMatchObject({
      code: "NODE_CONFLICT",
      status: 409,
    });

    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("rejects regeneration of messages outside the latest turn", async () => {
    await expect(
      regenerateNodeForOwner(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          assistantMessageId: "assistant_a",
          reply,
        },
      ),
    ).rejects.toMatchObject({
      code: "REGENERATE_NOT_LATEST",
      status: 400,
    });

    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});

describe("inherited conversation context", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([makeInheritedProject()]);
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
  });

  it("prepares child creation with the root-to-parent conversation", async () => {
    const context = await prepareChildContext(
      "owner_inherit",
      "project_inherit",
      "node_parent_inherit",
    );

    expect(context.contextTitles).toEqual(["Root title", "Parent title"]);
    expect(context.messages.map((message) => message.content)).toEqual([
      "Root prompt",
      "Root answer",
      "Parent prompt",
      "Parent answer",
    ]);
  });

  it("prepares child regeneration with the ancestor conversation", async () => {
    const context = await prepareRegenerateNodeContext(
      "owner_inherit",
      "project_inherit",
      "node_child_inherit",
      {
        assistantMessageId: "assistant_child_inherit",
      },
    );

    expect(context.instruction).toBe("Child prompt");
    expect(context.contextSummaries).toEqual([
      "Root title: Root summary",
      "Parent title: Parent summary",
    ]);
    expect(context.messages.map((message) => message.content)).toEqual([
      "Root prompt",
      "Root answer",
      "Parent prompt",
      "Parent answer",
    ]);
  });
});

describe("deleteProjectForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    updateNodePositionForOwnerMock.mockReset();
    readProjectsForSessionMock.mockResolvedValue([]);
    deleteProjectMock.mockResolvedValue(undefined);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
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
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
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

  it("persists drag positions without saving the whole project", async () => {
    const movedProject = makeProject();
    movedProject.nodes.node_regenerate = {
      ...movedProject.nodes.node_regenerate,
      position: { x: 42, y: 64 },
    };
    updateNodePositionForOwnerMock.mockResolvedValue(movedProject);

    const result = await updateNodeForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      { position: { x: 42, y: 64 } },
    );

    expect(result.nodes.node_regenerate.position).toEqual({ x: 42, y: 64 });
    expect(updateNodePositionForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      { x: 42, y: 64 },
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});

describe("updateProjectForOwner", () => {
  beforeEach(() => {
    readProjectsMock.mockReset();
    readProjectsForSessionMock.mockReset();
    deleteProjectMock.mockReset();
    saveProjectMock.mockReset();
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([makeProject()]);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
  });

  it("renames projects without changing the root node title", async () => {
    const result = await updateProjectForOwner(
      "owner_regenerate",
      "project_regenerate",
      { title: "  Renamed project  " },
    );

    expect(result.title).toBe("Renamed project");
    expect(result.nodes.node_regenerate).toMatchObject({
      title: "Regenerate node",
      titleManuallyEdited: false,
    });
    expect(saveProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSessionId: "owner_regenerate",
        title: "Renamed project",
        nodes: expect.objectContaining({
          node_regenerate: expect.objectContaining({
            title: "Regenerate node",
            titleManuallyEdited: false,
          }),
        }),
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
    updateNodePositionForOwnerMock.mockReset();
    readProjectsMock.mockResolvedValue([]);
    saveProjectMock.mockResolvedValue(undefined);
    updateNodePositionForOwnerMock.mockResolvedValue(null);
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
