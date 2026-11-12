import { describe, expect, it } from "vitest";
import {
  createAppendingNodeMessageProject,
  createBlankChildProject,
  createRegeneratingNodeProject,
  readNodeStreamingEvents,
  removeAppendedDraftMessages,
} from "@/lib/client/node-streaming";
import { addBlankChildNode } from "@/lib/server/project-model";
import type { ChatAttachment, Project } from "@/lib/types";

function makeProject(): Project {
  const timestamp = "2026-01-01T00:00:00.000Z";

  return {
    id: "project_streaming",
    title: "Original project",
    notes: "",
    rootNodeId: "node_streaming",
    nodes: {
      node_streaming: {
        id: "node_streaming",
        projectId: "project_streaming",
        parentId: null,
        title: "Original node title",
        titleManuallyEdited: false,
        summary: "Original node summary",
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
        children: [],
        position: { x: 120, y: 120 },
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

describe("node streaming helpers", () => {
  it("uses the same collision-free placement as the persisted child creator", () => {
    const project = makeProject();
    const parent = project.nodes[project.rootNodeId];
    const occupiedNode = {
      ...parent,
      id: "node_occupied",
      parentId: parent.id,
      branchType: "branch" as const,
      position: { x: 510, y: 120 },
    };
    const positionedProject: Project = {
      ...project,
      nodes: {
        ...project.nodes,
        [occupiedNode.id]: occupiedNode,
      },
    };

    const draft = createBlankChildProject(positionedProject, parent.id, "branch");
    const persisted = addBlankChildNode(
      positionedProject,
      parent.id,
      "branch",
      "node_persisted",
    );

    expect(draft?.node.position).toEqual({ x: 510, y: 384 });
    expect(persisted?.node.position).toEqual(draft?.node.position);
  });

  it("returns null when editing a user message outside the latest turn", () => {
    const result = createRegeneratingNodeProject(makeProject(), "node_streaming", {
      instruction: "Edited first prompt",
      userMessageId: "user_a",
    });

    expect(result).toBeNull();
  });

  it("clears the paired assistant when editing the latest user message", () => {
    const result = createRegeneratingNodeProject(makeProject(), "node_streaming", {
      instruction: "Edited second prompt",
      userMessageId: "user_b",
    });

    expect(result?.assistantMessageId).toBe("assistant_b");
    expect(result?.node.title).toBe("Original node title");
    // The project title was renamed manually, so it no longer follows the prompt.
    expect(result?.project.title).toBe("Original project");
    expect(result?.node.messages.map((message) => message.content)).toEqual([
      "First prompt",
      "First answer",
      "Edited second prompt",
      "",
    ]);
  });

  it("follows the edited prompt while the project title is derived from it", () => {
    const project = { ...makeProject(), title: "Second prompt" };
    const result = createRegeneratingNodeProject(project, "node_streaming", {
      instruction: "Edited second prompt",
      userMessageId: "user_b",
    });

    expect(result?.project.title).toBe("Edited second prompt");
  });

  it("returns null when retrying an assistant reply outside the latest turn", () => {
    const result = createRegeneratingNodeProject(makeProject(), "node_streaming", {
      assistantMessageId: "assistant_a",
    });

    expect(result).toBeNull();
  });

  it("rejects explicit regenerate targets from different turns", () => {
    const result = createRegeneratingNodeProject(makeProject(), "node_streaming", {
      instruction: "Edited first prompt",
      userMessageId: "user_a",
      assistantMessageId: "assistant_b",
    });

    expect(result).toBeNull();
  });

  it("appends an optimistic user and empty assistant turn without changing node title or summary", () => {
    const baseProject = makeProject();
    const project: Project = {
      ...baseProject,
      nodes: {
        ...baseProject.nodes,
        node_streaming: {
          ...baseProject.nodes.node_streaming,
          titleManuallyEdited: true,
        },
      },
    };
    const attachment: ChatAttachment = {
      id: "att_1",
      name: "paper.pdf",
      mimeType: "application/pdf",
      size: 1024,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "doc_1",
      documentStatus: "indexed",
    };

    const draft = createAppendingNodeMessageProject(
      project,
      "node_streaming",
      "  Explain the second assumption  ",
      [attachment],
    );

    expect(draft).not.toBeNull();
    expect(Object.keys(draft!.project.nodes)).toEqual(["node_streaming"]);
    expect(draft!.node.children).toEqual([]);
    expect(draft!.node.title).toBe("Original node title");
    expect(draft!.node.titleManuallyEdited).toBe(true);
    expect(draft!.node.summary).toBe("Original node summary");
    expect(draft!.project.title).toBe("Original project");
    expect(draft!.node.messages).toHaveLength(6);

    const appendedUser = draft!.node.messages[4];
    const appendedAssistant = draft!.node.messages[5];
    expect(appendedUser).toMatchObject({
      id: draft!.userMessageId,
      role: "user",
      content: "Explain the second assumption",
      attachments: [attachment],
    });
    expect(appendedAssistant).toMatchObject({
      id: draft!.assistantMessageId,
      role: "assistant",
      content: "",
      attachments: [],
    });
    expect(draft!.node.updatedAt > project.nodes.node_streaming.updatedAt).toBe(true);
    expect(draft!.project.updatedAt).toBe(draft!.node.updatedAt);
  });

  it("returns null from createAppendingNodeMessageProject for missing, blank, or empty-instruction calls", () => {
    const project = makeProject();
    const blankDraft = createBlankChildProject(project, "node_streaming", "branch");
    expect(blankDraft).not.toBeNull();

    expect(
      createAppendingNodeMessageProject(project, "missing_node", "Follow up"),
    ).toBeNull();
    expect(
      createAppendingNodeMessageProject(
        blankDraft!.project,
        blankDraft!.node.id,
        "Follow up on blank node",
      ),
    ).toBeNull();
    expect(
      createAppendingNodeMessageProject(project, "node_streaming", "   "),
    ).toBeNull();
  });

  it("removes appended draft messages and restores previous updatedAt while preserving concurrent updates", () => {
    const originalProject = makeProject();
    const previousUpdatedAt = originalProject.nodes.node_streaming.updatedAt;
    const draft = createAppendingNodeMessageProject(
      originalProject,
      "node_streaming",
      "Follow up question",
    );
    expect(draft).not.toBeNull();

    const concurrentlyModifiedProject: Project = {
      ...draft!.project,
      notes: "Concurrent note edit",
      updatedAt: "2026-02-01T00:00:00.000Z",
      nodes: {
        ...draft!.project.nodes,
        node_streaming: {
          ...draft!.project.nodes.node_streaming,
          position: { x: 480, y: 360 },
        },
        sibling_node: {
          ...originalProject.nodes.node_streaming,
          id: "sibling_node",
          parentId: "node_streaming",
          branchType: "branch",
          position: { x: 900, y: 120 },
        },
      },
    };

    const rolledBack = removeAppendedDraftMessages(
      concurrentlyModifiedProject,
      "node_streaming",
      [draft!.userMessageId, draft!.assistantMessageId],
      previousUpdatedAt,
    );

    expect(
      rolledBack.nodes.node_streaming.messages.map((message) => message.id),
    ).toEqual(["user_a", "assistant_a", "user_b", "assistant_b"]);
    expect(rolledBack.nodes.node_streaming.updatedAt).toBe(previousUpdatedAt);
    expect(rolledBack.nodes.node_streaming.position).toEqual({ x: 480, y: 360 });
    expect(rolledBack.nodes.sibling_node.position).toEqual({ x: 900, y: 120 });
    expect(rolledBack.notes).toBe("Concurrent note edit");
    expect(rolledBack.updatedAt).toBe("2026-02-01T00:00:00.000Z");

    expect(
      removeAppendedDraftMessages(rolledBack, "missing_node", ["msg_1"], previousUpdatedAt),
    ).toBe(rolledBack);
  });
});

describe("node streaming errors", () => {
  it("retains status, code, and request id for generic SSE failures", async () => {
    const response = new Response(
      "event: error\ndata: {\"message\":\"Request failed.\",\"status\":500,\"code\":\"DEEPSEEK_NOT_CONFIGURED\",\"requestId\":\"req_stream_failure\"}\n\n",
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );

    await expect(readNodeStreamingEvents(response, () => undefined)).rejects.toMatchObject({
      message:
        "Request failed. (HTTP 500, DEEPSEEK_NOT_CONFIGURED, requestId: req_stream_failure)",
      code: "DEEPSEEK_NOT_CONFIGURED",
      requestId: "req_stream_failure",
      status: 500,
    });
  });
});
