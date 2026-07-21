import { describe, expect, it } from "vitest";
import {
  createRegeneratingNodeProject,
  readNodeStreamingEvents,
} from "@/lib/client/node-streaming";
import type { Project } from "@/lib/types";

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
    expect(result?.project.title).toBe("Edited second prompt");
    expect(result?.node.messages.map((message) => message.content)).toEqual([
      "First prompt",
      "First answer",
      "Edited second prompt",
      "",
    ]);
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
