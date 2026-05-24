import { describe, expect, it, vi } from "vitest";
import { getContextTitles, getNodeConversationMessages } from "@/lib/graph";
import {
  addChildNode,
  createPendingRootProject,
  createRootProject,
  PENDING_ROOT_SUMMARY,
  PENDING_ROOT_TITLE,
  regenerateNode,
  removeNode,
  setNodeCollapsed,
  setProjectNotes,
  setProjectTitle,
  updateNodeTitle,
  updateNodePosition,
} from "@/lib/server/project-model";
import type { MockReply } from "@/lib/types";

const rootReply: MockReply = {
  title: "Root concept",
  summary: "Root summary",
  content: "Root content",
};

const childReply: MockReply = {
  title: "Child concept",
  summary: "Child summary",
  content: "Child content",
};

const citation = {
  index: 1,
  documentId: "document-citation-test",
  documentName: "source.pdf",
  chunkId: "chunk-citation-test",
  pageStart: 7,
  pageEnd: 7,
  headingPath: ["Chapter 1"],
  quote: "Citation source text.",
};

function expectConsistentGraph(project: ReturnType<typeof createRootProject>) {
  expect(project.nodes[project.rootNodeId]).toBeDefined();

  for (const node of Object.values(project.nodes)) {
    for (const childId of node.children) {
      const child = project.nodes[childId];
      expect(child, `${childId} should exist`).toBeDefined();
      expect(child.parentId).toBe(node.id);
    }

    if (node.parentId) {
      const parent = project.nodes[node.parentId];
      expect(parent, `${node.parentId} should exist`).toBeDefined();
      expect(parent.children).toContain(node.id);
    }
  }
}

function createMultiTurnProject() {
  const project = createRootProject("Original first prompt", rootReply);
  const node = project.nodes[project.rootNodeId];
  const timestamp = "2026-01-01T00:00:00.000Z";

  return {
    ...project,
    nodes: {
      ...project.nodes,
      [project.rootNodeId]: {
        ...node,
        messages: [
          {
            id: "user_a",
            role: "user" as const,
            content: "First prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_a",
            role: "assistant" as const,
            content: "First answer",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "user_b",
            role: "user" as const,
            content: "Second prompt",
            attachments: [],
            createdAt: timestamp,
          },
          {
            id: "assistant_b",
            role: "assistant" as const,
            content: "Second answer",
            attachments: [],
            createdAt: timestamp,
          },
        ],
      },
    },
  };
}

describe("project model helpers", () => {
  it("creates a root project with the initial user and assistant messages", () => {
    const project = createRootProject("  Graph search  ", rootReply);
    const rootNode = project.nodes[project.rootNodeId];

    expect(project.title).toBe("Graph search");
    expect(project.notes).toBe("");
    expect(rootNode).toMatchObject({
      projectId: project.id,
      parentId: null,
      title: "Root concept",
      titleManuallyEdited: false,
      position: { x: 120, y: 120 },
      branchType: "root",
      collapsed: false,
    });
    expect(rootNode.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(rootNode.messages.map((message) => message.content)).toEqual([
      "  Graph search  ",
      "Root content",
    ]);
  });

  it("stores attachment metadata on the root user message", () => {
    const attachment = {
      id: "attachment-root-test",
      name: "source.pdf",
      mimeType: "application/pdf",
      size: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "document-root-test",
      documentStatus: "indexed" as const,
    };

    const project = createRootProject("Graph search", rootReply, [attachment]);
    const rootNode = project.nodes[project.rootNodeId];

    expect(rootNode.messages[0].attachments).toEqual([attachment]);
    expect(rootNode.messages[1].attachments).toEqual([]);
  });

  it("stores assistant citation metadata from generated replies", () => {
    const project = createRootProject("Graph search", {
      ...rootReply,
      content: "Root content [[cite:1]]",
      citations: [citation],
    });
    const rootNode = project.nodes[project.rootNodeId];

    expect(rootNode.messages[1].citations).toEqual([citation]);

    const regenerated = regenerateNode(project, project.rootNodeId, {
      reply: {
        ...rootReply,
        content: "Updated content [[cite:1]]",
        citations: [{ ...citation, pageStart: 8, pageEnd: 9 }],
      },
    });

    expect(regenerated?.node.messages[1].citations).toEqual([
      { ...citation, pageStart: 8, pageEnd: 9 },
    ]);
  });

  it("creates a pending root project with an empty assistant message for streaming", () => {
    const attachment = {
      id: "attachment-pending-root-test",
      name: "pending-source.pdf",
      mimeType: "application/pdf",
      size: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "document-pending-root-test",
      documentStatus: "indexed" as const,
    };

    const result = createPendingRootProject("  Stream root topic  ", [attachment]);
    const rootNode = result.project.nodes[result.project.rootNodeId];
    const [userMessage, assistantMessage] = rootNode.messages;

    expect(result.project.title).toBe("Stream root topic");
    expect(result.node.id).toBe(result.project.rootNodeId);
    expect(result.assistantMessageId).toBe(assistantMessage.id);
    expect(rootNode).toMatchObject({
      projectId: result.project.id,
      parentId: null,
      title: PENDING_ROOT_TITLE,
      titleManuallyEdited: false,
      summary: PENDING_ROOT_SUMMARY,
      branchType: "root",
      collapsed: false,
    });
    expect(userMessage).toMatchObject({
      role: "user",
      content: "  Stream root topic  ",
      attachments: [attachment],
    });
    expect(assistantMessage).toMatchObject({
      role: "assistant",
      content: "",
      attachments: [],
    });
  });

  it("adds continue and branch children with deterministic offsets", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;

    const continued = addChildNode(project, rootId, "continue", "Next", childReply);
    expect(continued?.node).toMatchObject({
      parentId: rootId,
      titleManuallyEdited: false,
      position: { x: 120, y: 410 },
      branchType: "continue",
    });

    const branched = addChildNode(
      continued!.project,
      rootId,
      "branch",
      "Side path",
      childReply,
    );
    expect(branched?.node).toMatchObject({
      parentId: rootId,
      titleManuallyEdited: false,
      position: { x: 510, y: 120 },
      branchType: "branch",
    });
    expect(branched?.project.nodes[rootId].children).toEqual([
      continued!.node.id,
      branched!.node.id,
    ]);
  });

  it("stores attachment metadata on child user messages", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const attachment = {
      id: "attachment-test",
      name: "notes.pdf",
      mimeType: "application/pdf",
      size: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const continued = addChildNode(
      project,
      rootId,
      "continue",
      "Summarize this file",
      childReply,
      [attachment],
    );

    expect(continued?.node.messages[0].attachments).toEqual([attachment]);
    expect(continued?.node.messages[1].attachments).toEqual([]);
  });

  it("updates node state without mutating the original project", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;

    const moved = updateNodePosition(project, rootId, { x: 42, y: 64 });
    const collapsed = setNodeCollapsed(project, rootId, true);

    expect(moved?.nodes[rootId].position).toEqual({ x: 42, y: 64 });
    expect(collapsed?.nodes[rootId].collapsed).toBe(true);
    expect(project.nodes[rootId]).toMatchObject({
      position: { x: 120, y: 120 },
      collapsed: false,
    });
  });

  it("manually updates node titles and syncs the root project title", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const updated = updateNodeTitle(project, rootId, "Manual root title");

    expect(updated?.title).toBe("Manual root title");
    expect(updated?.nodes[rootId]).toMatchObject({
      title: "Manual root title",
      titleManuallyEdited: true,
    });
    expect(project.title).toBe("Graph search");
    expect(project.nodes[rootId].titleManuallyEdited).toBe(false);
  });

  it("updates project notes without mutating the original project", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const project = createRootProject("Graph search", rootReply);
      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      const updated = setProjectNotes(project, "## Notes\n\nSaved note");

      expect(updated.notes).toBe("## Notes\n\nSaved note");
      expect(updated.updatedAt).toBe("2026-01-01T00:00:01.000Z");
      expect(project.notes).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates project titles without changing the root node title", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const project = createRootProject("Graph search", rootReply);
      const rootId = project.rootNodeId;
      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      const updated = setProjectTitle(project, "  Renamed workspace  ");

      expect(updated?.title).toBe("Renamed workspace");
      expect(updated?.updatedAt).toBe("2026-01-01T00:00:01.000Z");
      expect(updated?.nodes[rootId]).toMatchObject({
        title: "Root concept",
        titleManuallyEdited: false,
      });
      expect(project.title).toBe("Graph search");
      expect(project.nodes[rootId].title).toBe("Root concept");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves manually edited titles when regenerating", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const project = createRootProject("Original prompt", rootReply);
      const rootId = project.rootNodeId;
      const [userMessage, assistantMessage] = project.nodes[rootId].messages;
      const titled = updateNodeTitle(project, rootId, "Manual root title")!;

      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      const regenerated = regenerateNode(titled, rootId, {
        instruction: "Edited prompt",
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        reply: {
          title: "AI replacement title",
          summary: "Regenerated summary",
          content: "Regenerated content",
        },
      });

      expect(regenerated?.project.title).toBe("Manual root title");
      expect(regenerated?.node).toMatchObject({
        title: "Manual root title",
        titleManuallyEdited: true,
        summary: "Regenerated summary",
      });
      expect(regenerated?.node.messages.map((message) => message.content)).toEqual([
        "Edited prompt",
        "Regenerated content",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("regenerates a node in place without mutating the original project", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const project = createRootProject("Original prompt", rootReply);
      const rootId = project.rootNodeId;
      const [userMessage, assistantMessage] = project.nodes[rootId].messages;

      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      const regenerated = regenerateNode(project, rootId, {
        instruction: "Edited prompt",
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        reply: {
          title: "Regenerated title",
          summary: "Regenerated summary",
          content: "Regenerated content",
        },
      });

      expect(regenerated?.project.title).toBe("Edited prompt");
      expect(regenerated?.node).toMatchObject({
        title: "Regenerated title",
        summary: "Regenerated summary",
        updatedAt: "2026-01-01T00:00:01.000Z",
      });
      expect(regenerated?.node.messages.map((message) => message.content)).toEqual([
        "Edited prompt",
        "Regenerated content",
      ]);
      expect(project.title).toBe("Original prompt");
      expect(project.nodes[rootId].messages.map((message) => message.content)).toEqual([
        "Original prompt",
        "Root content",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits an earlier user message by replacing its paired assistant reply", () => {
    const project = createMultiTurnProject();
    const rootId = project.rootNodeId;

    const regenerated = regenerateNode(project, rootId, {
      instruction: "Edited first prompt",
      userMessageId: "user_a",
      reply: {
        title: "Replacement title",
        summary: "Replacement summary",
        content: "Replacement first answer",
      },
    });

    expect(regenerated?.node.title).toBe("Root concept");
    expect(regenerated?.node.summary).toBe("Root summary");
    expect(regenerated?.project.title).toBe("Original first prompt");
    expect(regenerated?.node.messages.map((message) => message.content)).toEqual([
      "Edited first prompt",
      "Replacement first answer",
      "Second prompt",
      "Second answer",
    ]);
  });

  it("retries a later assistant reply while preserving earlier turns", () => {
    const project = createMultiTurnProject();
    const rootId = project.rootNodeId;

    const regenerated = regenerateNode(project, rootId, {
      assistantMessageId: "assistant_b",
      reply: {
        title: "Latest replacement title",
        summary: "Latest replacement summary",
        content: "Replacement second answer",
      },
    });

    expect(regenerated?.node).toMatchObject({
      title: "Latest replacement title",
      summary: "Latest replacement summary",
    });
    expect(regenerated?.node.messages.map((message) => message.content)).toEqual([
      "First prompt",
      "First answer",
      "Second prompt",
      "Replacement second answer",
    ]);
  });

  it("rejects explicit regenerate targets from different turns", () => {
    const project = createMultiTurnProject();

    expect(
      regenerateNode(project, project.rootNodeId, {
        instruction: "Edited first prompt",
        userMessageId: "user_a",
        assistantMessageId: "assistant_b",
        reply: childReply,
      }),
    ).toBeNull();
  });

  it("rejects regenerate targets with mismatched message roles", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const [userMessage, assistantMessage] = project.nodes[rootId].messages;

    expect(
      regenerateNode(project, rootId, {
        userMessageId: assistantMessage.id,
        reply: childReply,
      }),
    ).toBeNull();
    expect(
      regenerateNode(project, rootId, {
        assistantMessageId: userMessage.id,
        reply: childReply,
      }),
    ).toBeNull();
  });

  it("removes a non-root node and all descendants", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const continued = addChildNode(project, rootId, "continue", "Next", childReply)!;
    const branched = addChildNode(
      continued.project,
      continued.node.id,
      "branch",
      "Nested side path",
      childReply,
    )!;

    const result = removeNode(branched.project, continued.node.id);

    expect(result?.parentId).toBe(rootId);
    expect(result?.project.nodes[rootId].children).toEqual([]);
    expect(result?.project.nodes[continued.node.id]).toBeUndefined();
    expect(result?.project.nodes[branched.node.id]).toBeUndefined();
    expect(removeNode(result!.project, rootId)).toBeNull();
    expectConsistentGraph(result!.project);
  });

  it("keeps deep branch context and graph references consistent", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const continued = addChildNode(project, rootId, "continue", "Next", childReply)!;
    const branched = addChildNode(
      continued.project,
      continued.node.id,
      "branch",
      "Nested side path",
      { ...childReply, title: "Nested branch" },
    )!;

    expect(getContextTitles(branched.project, branched.node.id)).toEqual([
      rootReply.title,
      childReply.title,
      "Nested branch",
    ]);
    expectConsistentGraph(branched.project);
  });

  it("builds root-to-current conversation chains", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const continued = addChildNode(project, rootId, "continue", "Next", childReply)!;
    const branched = addChildNode(
      continued.project,
      continued.node.id,
      "branch",
      "Nested side path",
      { ...childReply, content: "Nested content" },
    )!;

    const rootMessages = getNodeConversationMessages(project, rootId);
    const childMessages = getNodeConversationMessages(continued.project, continued.node.id);
    const grandchildMessages = getNodeConversationMessages(
      branched.project,
      branched.node.id,
    );

    expect(rootMessages.map((item) => item.message.content)).toEqual([
      "Graph search",
      "Root content",
    ]);
    expect(rootMessages.every((item) => !item.inherited)).toBe(true);
    expect(childMessages.map((item) => item.message.content)).toEqual([
      "Graph search",
      "Root content",
      "Next",
      "Child content",
    ]);
    expect(childMessages.map((item) => item.inherited)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(grandchildMessages.map((item) => item.message.content)).toEqual([
      "Graph search",
      "Root content",
      "Next",
      "Child content",
      "Nested side path",
      "Nested content",
    ]);
  });

  it("keeps the current node messages when an ancestor is missing", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;
    const continued = addChildNode(project, rootId, "continue", "Next", childReply)!;
    const brokenProject = {
      ...continued.project,
      nodes: {
        ...continued.project.nodes,
        [continued.node.id]: {
          ...continued.node,
          parentId: "missing-parent",
        },
      },
    };

    expect(
      getNodeConversationMessages(brokenProject, continued.node.id).map(
        (item) => item.message.content,
      ),
    ).toEqual(["Next", "Child content"]);
  });
});
