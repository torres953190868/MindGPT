import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment, Project } from "@/lib/types";

const readProjectsMock = vi.hoisted(() => vi.fn());
const readProjectsForSessionMock = vi.hoisted(() => vi.fn());
const readProjectForOwnerMock = vi.hoisted(() => vi.fn());
const readProjectOwnerIdMock = vi.hoisted(() => vi.fn());
const deleteProjectMock = vi.hoisted(() => vi.fn());
const saveProjectMock = vi.hoisted(() => vi.fn());
const updateNodePositionForOwnerMock = vi.hoisted(() => vi.fn());
const getProjectsRepositoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/projects-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/projects-repository")>();

  return {
    ...actual,
    getProjectsRepository: getProjectsRepositoryMock,
  };
});

import {
  appendNodeMessageForOwner,
  deleteProjectForOwner,
  prepareAppendNodeMessageContext,
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

function resetRepositoryMocks(projects: Project[] = []) {
  readProjectsMock.mockReset();
  readProjectsForSessionMock.mockReset();
  readProjectForOwnerMock.mockReset();
  readProjectOwnerIdMock.mockReset();
  deleteProjectMock.mockReset();
  saveProjectMock.mockReset();
  updateNodePositionForOwnerMock.mockReset();
  getProjectsRepositoryMock.mockReset();

  readProjectsMock.mockResolvedValue(projects);
  readProjectsForSessionMock.mockResolvedValue([]);
  readProjectForOwnerMock.mockImplementation(
    async (ownerId: string, projectId: string) =>
      projects.find(
        (item) => item.id === projectId && item.ownerSessionId === ownerId,
      ) ?? null,
  );
  readProjectOwnerIdMock.mockImplementation(
    async (projectId: string) =>
      projects.find((item) => item.id === projectId)?.ownerSessionId ?? null,
  );
  deleteProjectMock.mockResolvedValue(undefined);
  saveProjectMock.mockResolvedValue(undefined);
  updateNodePositionForOwnerMock.mockResolvedValue(null);

  getProjectsRepositoryMock.mockReturnValue({
    readProjects: readProjectsMock,
    readProjectsForSession: readProjectsForSessionMock,
    readProjectForOwner: readProjectForOwnerMock,
    readProjectOwnerId: readProjectOwnerIdMock,
    deleteProject: deleteProjectMock,
    saveProject: saveProjectMock,
    updateNodePositionForOwner: updateNodePositionForOwnerMock,
  });
}

describe("prepareRegenerateNodeContext", () => {
  beforeEach(() => {
    resetRepositoryMocks([makeProject()]);
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
    resetRepositoryMocks([makeProject()]);
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
    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).toHaveBeenCalled();
  });

  it("accepts an expected version in an equivalent timestamp format", async () => {
    // Clients may hold the in-memory ISO variant ("...00.000Z") while the
    // stored value round-tripped through PostgREST ("...00+00:00"), or vice
    // versa. Both describe the same instant and must not conflict.
    const result = await regenerateNodeForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        assistantMessageId: "assistant_b",
        expectedNodeUpdatedAt: "2026-01-01T00:00:00+00:00",
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
    resetRepositoryMocks([makeInheritedProject()]);
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
    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_inherit",
      "project_inherit",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
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
    resetRepositoryMocks([]);
  });

  it("deletes owned projects and returns the refreshed owner list", async () => {
    resetRepositoryMocks([makeProject()]);

    await expect(
      deleteProjectForOwner("owner_regenerate", "project_regenerate"),
    ).resolves.toEqual([]);

    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(deleteProjectMock).toHaveBeenCalledWith("project_regenerate");
    expect(readProjectsForSessionMock).toHaveBeenCalledWith("owner_regenerate");
  });

  it("treats missing or stale project deletes as idempotent", async () => {
    resetRepositoryMocks([]);

    await expect(
      deleteProjectForOwner("owner_regenerate", "project_regenerate"),
    ).resolves.toEqual([]);

    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(readProjectsForSessionMock).toHaveBeenCalledWith("owner_regenerate");
  });
});

describe("updateNodeForOwner", () => {
  beforeEach(() => {
    resetRepositoryMocks([makeProject()]);
  });

  it("keeps a renamed project title when the root node title changes", async () => {
    const result = await updateNodeForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      { title: "  Manual root title  " },
    );

    expect(result.title).toBe("Regenerate project");
    expect(result.nodes.node_regenerate).toMatchObject({
      title: "Manual root title",
      titleManuallyEdited: true,
    });
    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerSessionId: "owner_regenerate",
        title: "Regenerate project",
      }),
    );
  });

  it("syncs the project title when it still matches the previous root title", async () => {
    resetRepositoryMocks([{ ...makeProject(), title: "Regenerate node" }]);

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
    expect(readProjectForOwnerMock).not.toHaveBeenCalled();
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});

describe("updateProjectForOwner", () => {
  beforeEach(() => {
    resetRepositoryMocks([makeProject()]);
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
    expect(readProjectForOwnerMock).toHaveBeenCalledWith(
      "owner_regenerate",
      "project_regenerate",
    );
    expect(readProjectsMock).not.toHaveBeenCalled();
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
    resetRepositoryMocks([]);
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

  it("queries readProjectOwnerId instead of readProjects and rejects syncing over another owner's project", async () => {
    const project = makeSyncProject();
    readProjectOwnerIdMock.mockResolvedValue("owner_other");

    await expect(
      syncProjectForOwner("owner_sync", project.id, project),
    ).rejects.toMatchObject({
      code: "PROJECT_OWNER_MISMATCH",
      status: 403,
    });

    expect(readProjectOwnerIdMock).toHaveBeenCalledWith(project.id);
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("allows syncing when readProjectOwnerId returns null or the same owner without calling readProjects", async () => {
    const project = makeSyncProject();
    readProjectOwnerIdMock.mockResolvedValueOnce(null);

    const firstDto = await syncProjectForOwner("owner_sync", project.id, project);
    expect(firstDto.id).toBe(project.id);
    expect(readProjectOwnerIdMock).toHaveBeenCalledWith(project.id);
    expect(readProjectsMock).not.toHaveBeenCalled();

    readProjectOwnerIdMock.mockResolvedValueOnce("owner_sync");
    const secondDto = await syncProjectForOwner("owner_sync", project.id, project);
    expect(secondDto.id).toBe(project.id);
    expect(readProjectsMock).not.toHaveBeenCalled();
    expect(saveProjectMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to readProjects when a partial repository mock omits targeted lookup methods", async () => {
    getProjectsRepositoryMock.mockReturnValue({
      readProjects: readProjectsMock,
      readProjectsForSession: readProjectsForSessionMock,
      deleteProject: deleteProjectMock,
      saveProject: saveProjectMock,
      updateNodePositionForOwner: updateNodePositionForOwnerMock,
    });
    readProjectsMock.mockResolvedValue([makeProject()]);

    const renamed = await updateProjectForOwner(
      "owner_regenerate",
      "project_regenerate",
      { title: "Fallback rename" },
    );
    expect(renamed.title).toBe("Fallback rename");
    expect(readProjectsMock).toHaveBeenCalledTimes(1);

    const syncProject = makeSyncProject();
    readProjectsMock.mockResolvedValue([
      { ...syncProject, ownerSessionId: "owner_other" },
    ]);
    await expect(
      syncProjectForOwner("owner_sync", syncProject.id, syncProject),
    ).rejects.toMatchObject({
      code: "PROJECT_OWNER_MISMATCH",
      status: 403,
    });
    expect(readProjectsMock).toHaveBeenCalledTimes(2);
  });
});

describe("prepareAppendNodeMessageContext", () => {
  const curriculumAttachment: ChatAttachment = {
    id: "att_curriculum_root",
    name: "Algorithms 101",
    mimeType: "application/x-branchmind-curriculum",
    size: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    curriculumId: "cur_algo",
  };

  const explicitDocAttachment: ChatAttachment = {
    id: "att_explicit_doc",
    name: "explicit.pdf",
    mimeType: "application/pdf",
    size: 120,
    createdAt: "2026-01-01T00:00:00.000Z",
    documentId: "doc_explicit",
    documentStatus: "indexed",
  };

  function makeAppendProject(): Project {
    const base = makeInheritedProject();
    const timestamp = "2026-01-01T00:00:00.000Z";

    return {
      ...base,
      notes: "Focus on Big-O intuition.",
      nodes: {
        ...base.nodes,
        node_root_inherit: {
          ...base.nodes.node_root_inherit,
          messages: [
            {
              ...base.nodes.node_root_inherit.messages[0],
              attachments: [curriculumAttachment],
            },
            base.nodes.node_root_inherit.messages[1],
          ],
        },
        node_parent_inherit: {
          ...base.nodes.node_parent_inherit,
          children: ["node_child_inherit", "node_sibling_branch", "node_blank_child"],
        },
        node_child_inherit: {
          ...base.nodes.node_child_inherit,
          messages: [
            {
              id: "user_child_1",
              role: "user",
              content: "Child first prompt",
              attachments: [attachmentA],
              createdAt: timestamp,
            },
            {
              id: "assistant_child_1",
              role: "assistant",
              content: "Child first answer",
              attachments: [],
              createdAt: timestamp,
            },
            {
              id: "user_child_2",
              role: "user",
              content: "Child second prompt",
              attachments: [attachmentB],
              createdAt: timestamp,
            },
            {
              id: "assistant_child_2",
              role: "assistant",
              content: "Child second answer",
              attachments: [],
              createdAt: timestamp,
            },
          ],
        },
        node_sibling_branch: {
          id: "node_sibling_branch",
          projectId: "project_inherit",
          parentId: "node_parent_inherit",
          title: "Sibling insight",
          titleManuallyEdited: false,
          summary: "Sibling takeaway",
          messages: [
            {
              id: "user_sib",
              role: "user",
              content: "Sibling prompt",
              attachments: [],
              createdAt: timestamp,
            },
            {
              id: "assistant_sib",
              role: "assistant",
              content: "Sibling answer",
              attachments: [],
              createdAt: timestamp,
            },
          ],
          children: [],
          position: { x: 800, y: 410 },
          branchType: "branch",
          collapsed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        node_blank_child: {
          id: "node_blank_child",
          projectId: "project_inherit",
          parentId: "node_parent_inherit",
          title: "New continuation",
          titleManuallyEdited: false,
          summary: "Write the first message from the node detail panel.",
          messages: [],
          children: [],
          position: { x: 120, y: 700 },
          branchType: "continue",
          collapsed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    };
  }

  beforeEach(() => {
    resetRepositoryMocks([makeAppendProject()]);
  });

  it("builds multi-turn treeContext, inheritedAttachments, contextualized retrievalQuery, and full conversation messages", async () => {
    const context = await prepareAppendNodeMessageContext(
      "owner_inherit",
      "project_inherit",
      "node_child_inherit",
      {
        instruction: "  How does the invariant hold in step 2?  ",
        sourceText: "Selected excerpt from Child second answer.",
        attachments: [explicitDocAttachment, attachmentA],
        expectedNodeUpdatedAt: "2026-01-01T00:00:00+00:00",
        userMemory: {
          profileSummary: "CS undergrad",
          preferredStyle: "Step-by-step proofs",
        },
      },
    );

    expect(context.instruction).toBe("How does the invariant hold in step 2?");
    expect(context.mode).toBe("branch");
    expect(context.attachments).toEqual([explicitDocAttachment, attachmentA]);

    // Inherited attachments scan current node latest-first (attachmentB; attachmentA is deduplicated against explicit),
    // then ancestors back to root (curriculumAttachment).
    expect(context.inheritedAttachments.map((att) => att.id)).toEqual([
      "attachment-b",
      "att_curriculum_root",
    ]);

    // Contextualized retrievalQuery includes primary instruction + sourceText and anchors on current node + root node
    expect(context.retrievalQuery).toContain(
      "How does the invariant hold in step 2?",
    );
    expect(context.retrievalQuery).toContain(
      "Selected excerpt from Child second answer.",
    );
    expect(context.retrievalQuery).toContain("Child title: Child summary");
    expect(context.retrievalQuery).toContain("Root title");

    // Path contextSummaries and messages include root -> parent -> current node
    expect(context.contextSummaries).toEqual([
      "Root title: Root summary",
      "Parent title: Parent summary",
      "Child title: Child summary",
    ]);
    expect(context.messages.map((m) => m.content)).toEqual([
      "Root prompt",
      "Root answer",
      "Parent prompt",
      "Parent answer",
      "Child first prompt",
      "Child first answer",
      "Child second prompt",
      "Child second answer",
    ]);

    // Multi-turn treeContext expands ancestor turns + both prior turns inside node_child_inherit,
    // excludes node_child_inherit itself from sideBranches while keeping sibling branch insights,
    // and preserves hasSourceText + userMemory.
    expect(context.treeContext.hasSourceText).toBe(true);
    expect(context.treeContext.userMemory).toEqual({
      profileSummary: "CS undergrad",
      preferredStyle: "Step-by-step proofs",
    });
    expect(
      context.treeContext.recentTurns.map((turn) => turn.userContent),
    ).toEqual(
      expect.arrayContaining(["Child first prompt", "Child second prompt"]),
    );
    expect(
      context.treeContext.sideBranches.some(
        (branch) => branch.nodeId === "node_child_inherit",
      ),
    ).toBe(false);
  });

  it("rejects empty instructions, missing nodes, blank nodes, and stale expectedNodeUpdatedAt", async () => {
    await expect(
      prepareAppendNodeMessageContext(
        "owner_inherit",
        "project_inherit",
        "node_child_inherit",
        { instruction: "   " },
      ),
    ).rejects.toMatchObject({
      code: "INSTRUCTION_REQUIRED",
      status: 400,
    });

    await expect(
      prepareAppendNodeMessageContext(
        "owner_inherit",
        "project_inherit",
        "missing_node",
        { instruction: "Follow up" },
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    await expect(
      prepareAppendNodeMessageContext(
        "owner_inherit",
        "project_inherit",
        "node_blank_child",
        { instruction: "Follow up on blank" },
      ),
    ).rejects.toMatchObject({
      code: "NODE_IS_BLANK",
      status: 400,
    });

    await expect(
      prepareAppendNodeMessageContext(
        "owner_inherit",
        "project_inherit",
        "node_child_inherit",
        {
          instruction: "Follow up",
          expectedNodeUpdatedAt: "2025-12-31T23:59:59.000Z",
        },
      ),
    ).rejects.toMatchObject({
      code: "NODE_CONFLICT",
      status: 409,
    });
  });
});

describe("appendNodeMessageForOwner", () => {
  beforeEach(() => {
    const project = makeProject();
    project.nodes.node_blank = {
      id: "node_blank",
      projectId: project.id,
      parentId: project.rootNodeId,
      title: "New continuation",
      titleManuallyEdited: false,
      summary: "Write the first message from the node detail panel.",
      messages: [],
      children: [],
      position: { x: 120, y: 410 },
      branchType: "continue",
      collapsed: false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    project.nodes[project.rootNodeId].children = ["node_blank"];
    resetRepositoryMocks([project]);
  });

  const followUpReply = {
    title: "Should Not Overwrite Node Title",
    summary: "Updated third-turn summary",
    content: "Third answer with follow-up detail",
  };

  it("appends user and assistant turns, preserves titles, updates summary, and saves the owned project", async () => {
    const result = await appendNodeMessageForOwner(
      "owner_regenerate",
      "project_regenerate",
      "node_regenerate",
      {
        instruction: "  Third prompt  ",
        reply: followUpReply,
        attachments: [attachmentA],
        expectedNodeUpdatedAt: "2026-01-01T00:00:00+00:00",
      },
    );

    expect(result.project.title).toBe("Regenerate project");
    expect(result.node.title).toBe("Regenerate node");
    expect(result.node.summary).toBe("Updated third-turn summary");
    expect(result.node.messages).toHaveLength(6);
    expect(result.node.messages.slice(-2).map((m) => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments,
    }))).toEqual([
      {
        role: "user",
        content: "Third prompt",
        attachments: [attachmentA],
      },
      {
        role: "assistant",
        content: "Third answer with follow-up detail",
        attachments: [],
      },
    ]);
    expect(saveProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project_regenerate",
        ownerSessionId: "owner_regenerate",
        title: "Regenerate project",
      }),
    );
  });

  it("rejects stale expectedNodeUpdatedAt with 409 NODE_CONFLICT without saving", async () => {
    await expect(
      appendNodeMessageForOwner(
        "owner_regenerate",
        "project_regenerate",
        "node_regenerate",
        {
          instruction: "Third prompt",
          reply: followUpReply,
          expectedNodeUpdatedAt: "2025-01-01T00:00:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      code: "NODE_CONFLICT",
      status: 409,
    });

    expect(saveProjectMock).not.toHaveBeenCalled();
  });

  it("rejects blank nodes with 400 NODE_IS_BLANK and missing nodes with 404 NOT_FOUND", async () => {
    await expect(
      appendNodeMessageForOwner(
        "owner_regenerate",
        "project_regenerate",
        "node_blank",
        {
          instruction: "Populate via wrong endpoint",
          reply: followUpReply,
        },
      ),
    ).rejects.toMatchObject({
      code: "NODE_IS_BLANK",
      status: 400,
    });

    await expect(
      appendNodeMessageForOwner(
        "owner_regenerate",
        "project_regenerate",
        "node_missing",
        {
          instruction: "Missing node",
          reply: followUpReply,
        },
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    expect(saveProjectMock).not.toHaveBeenCalled();
  });
});
