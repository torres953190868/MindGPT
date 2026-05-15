import { describe, expect, it, vi } from "vitest";
import { getContextTitles } from "@/lib/graph";
import {
  addChildNode,
  createRootProject,
  regenerateNode,
  removeNode,
  setNodeCollapsed,
  setProjectNotes,
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

  it("adds continue and branch children with deterministic offsets", () => {
    const project = createRootProject("Graph search", rootReply);
    const rootId = project.rootNodeId;

    const continued = addChildNode(project, rootId, "continue", "Next", childReply);
    expect(continued?.node).toMatchObject({
      parentId: rootId,
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
});
