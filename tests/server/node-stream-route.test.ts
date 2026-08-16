import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";

const getBranchMindAuthContextMock = vi.hoisted(() => vi.fn());
const assertValidRequestOriginMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());
const getAccountPlanForModelAccessMock = vi.hoisted(() => vi.fn());
const trackDailyAiMessageUsageMock = vi.hoisted(() => vi.fn());
const prepareChildContextMock = vi.hoisted(() => vi.fn());
const createChildNodeForOwnerMock = vi.hoisted(() => vi.fn());
const getWorkspaceDocumentContextsForOwnerMock = vi.hoisted(() => vi.fn());
const getWorkspaceCurriculumContextsForOwnerMock = vi.hoisted(() => vi.fn());
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
  prepareChildContext: prepareChildContextMock,
  createChildNodeForOwner: createChildNodeForOwnerMock,
}));

vi.mock("@/lib/server/rag/service", () => ({
  getWorkspaceDocumentContextsForOwner: getWorkspaceDocumentContextsForOwnerMock,
}));

vi.mock("@/lib/server/curriculum-context", () => ({
  getWorkspaceCurriculumContextsForOwner: getWorkspaceCurriculumContextsForOwnerMock,
}));

vi.mock("@/lib/server/deepseek-streaming", () => ({
  streamDeepSeekReply: streamDeepSeekReplyMock,
}));

const routeContext = {
  params: Promise.resolve({ projectId: "project_test" }),
};

function createStreamRequest(body: Record<string, unknown> = {}) {
  return new NextRequest(
    "http://localhost/api/projects/project_test/nodes/stream",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        parentId: "node_root",
        mode: "continue",
        instruction: "继续讲下一个关键知识点。",
        ...body,
      }),
    },
  );
}

describe("POST /api/projects/[projectId]/nodes/stream", () => {
  beforeEach(() => {
    getBranchMindAuthContextMock.mockReset();
    assertValidRequestOriginMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getAccountPlanForModelAccessMock.mockReset();
    trackDailyAiMessageUsageMock.mockReset();
    prepareChildContextMock.mockReset();
    createChildNodeForOwnerMock.mockReset();
    getWorkspaceDocumentContextsForOwnerMock.mockReset();
    getWorkspaceCurriculumContextsForOwnerMock.mockReset();
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
    getAccountPlanForModelAccessMock.mockResolvedValue("free");
    trackDailyAiMessageUsageMock.mockResolvedValue(undefined);
    prepareChildContextMock.mockResolvedValue({
      contextSummaries: [],
      messages: [],
    });
    getWorkspaceDocumentContextsForOwnerMock.mockResolvedValue([]);
    getWorkspaceCurriculumContextsForOwnerMock.mockResolvedValue([]);
    createChildNodeForOwnerMock.mockResolvedValue({
      project: { id: "project_test" },
      node: { id: "node_new" },
    });
    streamDeepSeekReplyMock.mockImplementation(async function* () {
      yield {
        type: "complete",
        reply: { title: "标题", summary: "摘要", content: "内容" },
      };
    });
  });

  it("returns 429 with AI_MESSAGE_LIMIT_REACHED when the daily limit is exceeded", async () => {
    trackDailyAiMessageUsageMock.mockRejectedValue(
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
      "@/app/api/projects/[projectId]/nodes/stream/route"
    );

    const response = await POST(createStreamRequest(), routeContext);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("AI_MESSAGE_LIMIT_REACHED");
    expect(body.error.message).toBe(
      "You have reached today's AI message limit. Please come back tomorrow.",
    );
    expect(body.error.details).toEqual({ limit: 50 });
    expect(streamDeepSeekReplyMock).not.toHaveBeenCalled();
    expect(createChildNodeForOwnerMock).not.toHaveBeenCalled();
  });

  it("counts one AI message before streaming when under the limit", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/stream/route"
    );

    const response = await POST(createStreamRequest(), routeContext);
    const sseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(trackDailyAiMessageUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user_test", authMode: "supabase" }),
    );
    expect(
      trackDailyAiMessageUsageMock.mock.invocationCallOrder[0],
    ).toBeLessThan(streamDeepSeekReplyMock.mock.invocationCallOrder[0]);
    expect(sseText).toContain("event: complete");
    expect(sseText).toContain("node_new");
  });

  it("still streams when usage tracking fails open", async () => {
    // The helper swallows missing-table errors (PGRST205/42P01) and resolves,
    // so the request must proceed exactly like a tracked one.
    trackDailyAiMessageUsageMock.mockResolvedValue(undefined);
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/stream/route"
    );

    const response = await POST(createStreamRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(streamDeepSeekReplyMock).toHaveBeenCalledOnce();
  });

  it("resolves attached curricula and passes them to the reply stream", async () => {
    const curriculumContexts = [
      {
        curriculumId: "cur_1",
        versionId: "ver_1",
        title: "Deep Learning Foundations",
        versionLabel: "v1",
        outline: "- Foundations",
        snippets: [],
      },
    ];
    getWorkspaceCurriculumContextsForOwnerMock.mockResolvedValue(curriculumContexts);
    const { POST } = await import(
      "@/app/api/projects/[projectId]/nodes/stream/route"
    );

    const response = await POST(
      createStreamRequest({
        attachments: [
          {
            id: "att_1",
            name: "Deep Learning Foundations",
            mimeType: "application/x-branchmind-curriculum",
            size: 0,
            createdAt: "2026-08-16T00:00:00.000Z",
            curriculumId: "cur_1",
          },
        ],
      }),
      routeContext,
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(getWorkspaceCurriculumContextsForOwnerMock).toHaveBeenCalledWith(
      "user_test",
      expect.arrayContaining([
        expect.objectContaining({ curriculumId: "cur_1" }),
      ]),
      "继续讲下一个关键知识点。",
    );
    expect(streamDeepSeekReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ curriculumContexts }),
    );
  });
});
