import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment, ChatDocumentContext, MockReply } from "@/lib/types";

const streamDeepSeekReplyMock = vi.hoisted(() => vi.fn());
const prepareRegenerateNodeContextMock = vi.hoisted(() => vi.fn());
const regenerateNodeForOwnerMock = vi.hoisted(() => vi.fn());
const getWorkspaceDocumentContextsForOwnerMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_regenerate", email: null, authMode: "local" },
    session: { id: "user_regenerate", isNew: false },
  })),
}));

vi.mock("@/lib/server/deepseek-streaming", () => ({
  streamDeepSeekReply: streamDeepSeekReplyMock,
}));

vi.mock("@/lib/server/projects-service", () => ({
  prepareRegenerateNodeContext: prepareRegenerateNodeContextMock,
  regenerateNodeForOwner: regenerateNodeForOwnerMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  getWorkspaceDocumentContextsForOwner: getWorkspaceDocumentContextsForOwnerMock,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

const attachment: ChatAttachment = {
  id: "attachment-route",
  name: "memory.pdf",
  mimeType: "application/pdf",
  size: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  documentId: "doc_memory",
  documentStatus: "indexed",
};

const documentContext: ChatDocumentContext = {
  documentId: "doc_memory",
  fileName: "memory.pdf",
  title: "Memory Systems",
  snippets: [
    {
      chunkId: "chunk_memory",
      pageStart: 3,
      pageEnd: 3,
      headingPath: ["Retrieval"],
      content: "Retrieval cues help recall.",
    },
  ],
};

const reply: MockReply = {
  title: "Regenerated",
  summary: "Regenerated with PDF context.",
  content: "Regenerated content.",
};

function createRegenerateRequest() {
  return new NextRequest(
    "http://localhost/api/projects/project_route/nodes/node_route/regenerate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        instruction: "Edited memory prompt",
        userMessageId: "user_memory",
      }),
    },
  );
}

describe("node regenerate route", () => {
  beforeEach(() => {
    streamDeepSeekReplyMock.mockReset();
    prepareRegenerateNodeContextMock.mockReset();
    regenerateNodeForOwnerMock.mockReset();
    getWorkspaceDocumentContextsForOwnerMock.mockReset();
    checkRateLimitAsyncMock.mockReset();

    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    prepareRegenerateNodeContextMock.mockResolvedValue({
      node: { id: "node_route" },
      instruction: "Edited memory prompt",
      attachments: [attachment],
      mode: "continue",
      contextSummaries: ["Root: Summary"],
      messages: [{ role: "user", content: "Parent context" }],
    });
    getWorkspaceDocumentContextsForOwnerMock.mockResolvedValue([documentContext]);
    streamDeepSeekReplyMock.mockImplementation(async function* () {
      yield { type: "complete", reply };
    });
    regenerateNodeForOwnerMock.mockResolvedValue({
      project: { id: "project_route" },
      node: { id: "node_route" },
    });
  });

  it("adds retrieved PDF context when regenerating a message with PDF attachments", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/regenerate/route"
    );

    const response = await POST(createRegenerateRequest(), {
      params: Promise.resolve({
        projectId: "project_route",
        nodeId: "node_route",
      }),
    });

    await response.text();

    expect(response.status).toBe(200);
    expect(getWorkspaceDocumentContextsForOwnerMock).toHaveBeenCalledWith(
      "user_regenerate",
      [attachment],
      "Edited memory prompt",
    );
    expect(streamDeepSeekReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Edited memory prompt",
        documentContexts: [documentContext],
      }),
    );
  });
});
