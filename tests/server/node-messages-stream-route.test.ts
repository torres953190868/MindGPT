import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";
import type {
  ChatAttachment,
  ChatCurriculumContext,
  ChatDocumentContext,
} from "@/lib/types";

const getBranchMindAuthContextMock = vi.hoisted(() => vi.fn());
const assertValidRequestOriginMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());
const getAccountPlanForModelAccessMock = vi.hoisted(() => vi.fn());
const trackDailyAiMessageUsageMock = vi.hoisted(() => vi.fn());
const prepareAppendNodeMessageContextMock = vi.hoisted(() => vi.fn());
const appendNodeMessageForOwnerMock = vi.hoisted(() => vi.fn());
const getWorkspaceDocumentContextsForOwnerMock = vi.hoisted(() => vi.fn());
const getWorkspaceCurriculumContextsForOwnerMock = vi.hoisted(() => vi.fn());
const resolveUserMemorySlotForOwnerMock = vi.hoisted(() => vi.fn());
const recordCanvasTurnMemoryForOwnerMock = vi.hoisted(() => vi.fn());
const streamDeepSeekReplyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: getBranchMindAuthContextMock,
}));

vi.mock("@/lib/server/security", () => ({
  assertValidRequestOrigin: assertValidRequestOriginMock,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/account-plan", () => ({
  getAccountPlanForModelAccess: getAccountPlanForModelAccessMock,
}));

vi.mock("@/lib/server/ai-usage", () => ({
  trackDailyAiMessageUsage: trackDailyAiMessageUsageMock,
}));

vi.mock("@/lib/server/projects-service", () => ({
  prepareAppendNodeMessageContext: prepareAppendNodeMessageContextMock,
  appendNodeMessageForOwner: appendNodeMessageForOwnerMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  getWorkspaceDocumentContextsForOwner: getWorkspaceDocumentContextsForOwnerMock,
}));

vi.mock("@/lib/server/curriculum-context", () => ({
  getWorkspaceCurriculumContextsForOwner: getWorkspaceCurriculumContextsForOwnerMock,
}));

vi.mock("@/lib/server/user-memory", () => ({
  resolveUserMemorySlotForOwner: resolveUserMemorySlotForOwnerMock,
  recordCanvasTurnMemoryForOwner: recordCanvasTurnMemoryForOwnerMock,
}));

vi.mock("@/lib/server/deepseek-streaming", () => ({
  streamDeepSeekReply: streamDeepSeekReplyMock,
}));

const routeContext = {
  params: Promise.resolve({
    projectId: "project_test",
    nodeId: "node_target",
  }),
};

function createAppendStreamRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost/api/projects/project_test/nodes/node_target/messages/stream",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        instruction: "Give a concrete worked example.",
        ...body,
      }),
    },
  );
}

describe("POST /api/projects/[projectId]/nodes/[nodeId]/messages/stream", () => {
  beforeEach(() => {
    getBranchMindAuthContextMock.mockReset();
    assertValidRequestOriginMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getAccountPlanForModelAccessMock.mockReset();
    trackDailyAiMessageUsageMock.mockReset();
    prepareAppendNodeMessageContextMock.mockReset();
    appendNodeMessageForOwnerMock.mockReset();
    getWorkspaceDocumentContextsForOwnerMock.mockReset();
    getWorkspaceCurriculumContextsForOwnerMock.mockReset();
    resolveUserMemorySlotForOwnerMock.mockReset();
    recordCanvasTurnMemoryForOwnerMock.mockReset();
    streamDeepSeekReplyMock.mockReset();

    getBranchMindAuthContextMock.mockResolvedValue({
      principal: { id: "user_test", email: null, authMode: "supabase" },
      session: { id: "session_test", isNew: false },
    });
    assertValidRequestOriginMock.mockReturnValue({
      allowed: true,
      origin: "http://localhost",
      source: "origin",
    });
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      storage: "map",
    });
    getAccountPlanForModelAccessMock.mockResolvedValue("pro");
    trackDailyAiMessageUsageMock.mockResolvedValue(undefined);
    prepareAppendNodeMessageContextMock.mockImplementation(
      async (_ownerId: string, _projectId: string, nodeId: string, update: Record<string, unknown>) => ({
        node: { id: nodeId },
        instruction: update.instruction,
        attachments: (update.attachments as ChatAttachment[] | undefined) ?? [],
        inheritedAttachments: [],
        retrievalQuery: `${String(update.instruction)}\nNode title: Node summary`,
        mode: "continue",
        contextSummaries: ["Root: Summary", "Node title: Node summary"],
        messages: [
          { id: "m1", role: "user", content: "Initial question", attachments: [], createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "m2", role: "assistant", content: "Initial answer", attachments: [], createdAt: "2026-01-01T00:00:00.000Z" },
        ],
        treeContext: {
          mode: "continue",
          hasSourceText: Boolean(update.sourceText),
          contextTitles: ["Root"],
          contextSummaries: ["Root: Summary"],
          rootAnchor: null,
          foldedAncestors: [],
          recentTurns: [],
          sideBranches: [],
          pinnedProjectNotes: "",
          policy: {
            mode: "continue",
            hasSourceText: Boolean(update.sourceText),
            maxRecentFullNodes: 3,
            sideBranchLookbackDepth: 2,
            maxSideBranches: 3,
            includeProjectNotes: true,
            budgets: {
              recentTurnsChars: 6000,
              foldedAncestorsChars: 1600,
              sideBranchesChars: 900,
              projectNotesChars: 1200,
              userMemoryChars: 1000,
            },
            modeGuidance: "",
          },
        },
      }),
    );
    getWorkspaceDocumentContextsForOwnerMock.mockResolvedValue([]);
    getWorkspaceCurriculumContextsForOwnerMock.mockResolvedValue([]);
    resolveUserMemorySlotForOwnerMock.mockResolvedValue(undefined);
    recordCanvasTurnMemoryForOwnerMock.mockResolvedValue(undefined);
    appendNodeMessageForOwnerMock.mockResolvedValue({
      project: { id: "project_test" },
      node: { id: "node_target", title: "Node title", summary: "Updated summary" },
    });
    streamDeepSeekReplyMock.mockImplementation(async function* () {
      yield { type: "delta", contentDelta: "Worked " };
      yield { type: "delta", contentDelta: "example." };
      yield {
        type: "complete",
        reply: {
          title: "Ignored Follow-up Title",
          summary: "Updated summary",
          content: "Worked example.",
        },
      };
    });
  });

  it("streams delta and complete SSE events, persists appended turn, and records turn memory", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/messages/stream/route"
    );

    const response = await POST(
      createAppendStreamRequest({
        sourceText: "Selected formula",
        expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
        modelSelection: { providerId: "deepseek", model: "deepseek-chat" },
        skill: {
          id: "skill_1",
          name: "Tutor",
          description: "",
          instructions: "Use clear steps.",
          version: "v1",
        },
      }),
      routeContext,
    );
    const sseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    expect(sseText).toContain('event: delta\ndata: {"contentDelta":"Worked "}');
    expect(sseText).toContain('event: delta\ndata: {"contentDelta":"example."}');
    expect(sseText).toContain("event: complete");
    expect(sseText).toContain('"Updated summary"');

    expect(streamDeepSeekReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        llmTask: "node_generation",
        mode: "continue",
        instruction: "Give a concrete worked example.",
        contextTitles: ["Root: Summary", "Node title: Node summary"],
        messages: [
          { role: "user", content: "Initial question" },
          { role: "assistant", content: "Initial answer" },
        ],
        sourceText: "Selected formula",
        modelSelection: { providerId: "deepseek", model: "deepseek-chat" },
        userPlan: "pro",
        skill: expect.objectContaining({ id: "skill_1" }),
      }),
    );

    expect(appendNodeMessageForOwnerMock).toHaveBeenCalledWith(
      "user_test",
      "project_test",
      "node_target",
      {
        instruction: "Give a concrete worked example.",
        reply: {
          title: "Ignored Follow-up Title",
          summary: "Updated summary",
          content: "Worked example.",
        },
        attachments: [],
        expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(recordCanvasTurnMemoryForOwnerMock).toHaveBeenCalledWith({
      ownerId: "user_test",
      projectId: "project_test",
      nodeId: "node_target",
      mode: "continue",
      instruction: "Give a concrete worked example.",
      sourceText: "Selected formula",
      reply: {
        title: "Ignored Follow-up Title",
        summary: "Updated summary",
        content: "Worked example.",
      },
      contextSummaries: ["Root: Summary", "Node title: Node summary"],
    });
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
      storage: "map",
    });
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/messages/stream/route"
    );

    const response = await POST(createAppendStreamRequest(), routeContext);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "append-node-message",
        sessionId: "user_test",
      }),
    );
    expect(trackDailyAiMessageUsageMock).not.toHaveBeenCalled();
    expect(streamDeepSeekReplyMock).not.toHaveBeenCalled();
  });

  it("enforces daily AI message usage before streaming", async () => {
    trackDailyAiMessageUsageMock.mockRejectedValueOnce(
      new HttpError(
        "You have reached today's AI message limit. Please come back tomorrow.",
        {
          code: "AI_MESSAGE_LIMIT_REACHED",
          details: { limit: 50 },
          expose: true,
          status: 429,
        },
      ),
    );
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/messages/stream/route"
    );

    const limitedResponse = await POST(createAppendStreamRequest(), routeContext);
    const limitedBody = await limitedResponse.json();

    expect(limitedResponse.status).toBe(429);
    expect(limitedBody.error.code).toBe("AI_MESSAGE_LIMIT_REACHED");
    expect(limitedBody.error.details).toEqual({ limit: 50 });
    expect(streamDeepSeekReplyMock).not.toHaveBeenCalled();

    // Succeeds and tracks before streaming when under the limit
    const okResponse = await POST(createAppendStreamRequest(), routeContext);
    await okResponse.text();

    expect(okResponse.status).toBe(200);
    expect(
      trackDailyAiMessageUsageMock.mock.invocationCallOrder[1],
    ).toBeLessThan(streamDeepSeekReplyMock.mock.invocationCallOrder[0]);
  });

  it("resolves inherited document/curriculum contexts and user memory using contextualized retrievalQuery", async () => {
    const explicitAttachment: ChatAttachment = {
      id: "att_explicit",
      name: "notes.pdf",
      mimeType: "application/pdf",
      size: 100,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "doc_explicit",
      documentStatus: "indexed",
    };
    const inheritedDocAttachment: ChatAttachment = {
      id: "att_inherited_doc",
      name: "textbook.pdf",
      mimeType: "application/pdf",
      size: 200,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: "doc_inherited",
      documentStatus: "indexed",
    };
    const inheritedCurriculumAttachment: ChatAttachment = {
      id: "att_inherited_cur",
      name: "Graph Theory",
      mimeType: "application/x-branchmind-curriculum",
      size: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      curriculumId: "cur_graphs",
    };
    const documentContexts: ChatDocumentContext[] = [
      {
        documentId: "doc_inherited",
        fileName: "textbook.pdf",
        title: "Textbook",
        snippets: [
          {
            chunkId: "chunk_1",
            pageStart: 4,
            pageEnd: 4,
            headingPath: ["BFS"],
            content: "Queue-based traversal.",
          },
        ],
      },
    ];
    const curriculumContexts: ChatCurriculumContext[] = [
      {
        curriculumId: "cur_graphs",
        versionId: "ver_1",
        title: "Graph Theory",
        versionLabel: "v1",
        outline: "- Traversals",
        snippets: [],
      },
    ];
    const userMemory = {
      profileSummary: "Algorithms learner",
      concepts: [{ concept: "BFS", status: "learning" as const }],
    };

    prepareAppendNodeMessageContextMock.mockResolvedValue({
      node: { id: "node_target" },
      instruction: "Give a concrete worked example.",
      attachments: [explicitAttachment],
      inheritedAttachments: [
        inheritedDocAttachment,
        inheritedCurriculumAttachment,
      ],
      retrievalQuery: "Give a concrete worked example.\nBFS: Shortest paths",
      mode: "branch",
      contextSummaries: ["BFS: Shortest paths"],
      messages: [{ role: "user", content: "Prior" }],
    });
    getWorkspaceDocumentContextsForOwnerMock.mockResolvedValue(documentContexts);
    getWorkspaceCurriculumContextsForOwnerMock.mockResolvedValue(curriculumContexts);
    resolveUserMemorySlotForOwnerMock.mockResolvedValue(userMemory);

    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/messages/stream/route"
    );

    const response = await POST(
      createAppendStreamRequest({ attachments: [explicitAttachment] }),
      routeContext,
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(getWorkspaceDocumentContextsForOwnerMock).toHaveBeenCalledWith(
      "user_test",
      [explicitAttachment],
      "Give a concrete worked example.\nBFS: Shortest paths",
      {
        inheritedAttachments: [
          inheritedDocAttachment,
          inheritedCurriculumAttachment,
        ],
      },
    );
    expect(getWorkspaceCurriculumContextsForOwnerMock).toHaveBeenCalledWith(
      "user_test",
      [explicitAttachment],
      "Give a concrete worked example.\nBFS: Shortest paths",
      {
        inheritedAttachments: [
          inheritedDocAttachment,
          inheritedCurriculumAttachment,
        ],
      },
    );
    expect(resolveUserMemorySlotForOwnerMock).toHaveBeenCalledWith(
      "user_test",
      "Give a concrete worked example.\nBFS: Shortest paths",
    );
    expect(streamDeepSeekReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "branch",
        documentContexts,
        curriculumContexts,
        userMemory,
      }),
    );
  });

  it("handles 409 NODE_CONFLICT both before streaming and during stream persistence", async () => {
    const conflictError = new HttpError(
      "This conversation was updated in another window. Reload and try again.",
      {
        code: "NODE_CONFLICT",
        expose: true,
        status: 409,
      },
    );
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/[nodeId]/messages/stream/route"
    );

    // 1. Pre-stream conflict in prepareAppendNodeMessageContext returns 409 JSON
    prepareAppendNodeMessageContextMock.mockRejectedValueOnce(conflictError);
    const preStreamResponse = await POST(
      createAppendStreamRequest({
        expectedNodeUpdatedAt: "2025-01-01T00:00:00.000Z",
      }),
      routeContext,
    );
    const preStreamBody = await preStreamResponse.json();

    expect(preStreamResponse.status).toBe(409);
    expect(preStreamBody.error.code).toBe("NODE_CONFLICT");
    expect(streamDeepSeekReplyMock).not.toHaveBeenCalled();

    // 2. Concurrent conflict detected in appendNodeMessageForOwner emits SSE error event
    appendNodeMessageForOwnerMock.mockRejectedValueOnce(conflictError);
    const midStreamResponse = await POST(
      createAppendStreamRequest({
        expectedNodeUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
      routeContext,
    );
    const sseText = await midStreamResponse.text();

    expect(midStreamResponse.status).toBe(200);
    expect(sseText).toContain("event: error");
    expect(sseText).toContain('"code":"NODE_CONFLICT"');
    expect(sseText).toContain('"status":409');
    expect(recordCanvasTurnMemoryForOwnerMock).not.toHaveBeenCalled();
  });
});
