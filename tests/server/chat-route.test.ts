import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockReply } from "@/lib/types";

const requestDeepSeekReplyMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(async () => ({
    principal: { id: "user_chat", email: null, authMode: "local" },
    session: { id: "user_chat", isNew: false },
  })),
}));

vi.mock("@/lib/server/account-plan", () => ({
  getAccountPlanForModelAccess: vi.fn(async () => "free"),
}));

vi.mock("@/lib/server/deepseek", () => ({
  requestDeepSeekReply: requestDeepSeekReplyMock,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

const reply: MockReply = {
  title: "Chat title",
  summary: "Chat summary.",
  content: "Chat content.",
};

function chatRequest(body: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

async function postChat(body: unknown, origin?: string) {
  const { POST } = await import("@/app/api/chat/route");
  return POST(chatRequest(body, origin));
}

describe("chat route", () => {
  beforeEach(() => {
    requestDeepSeekReplyMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    requestDeepSeekReplyMock.mockResolvedValue(reply);
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("returns a reply for a valid request", async () => {
    const response = await postChat({ instruction: "Explain recursion" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      title: reply.title,
      summary: reply.summary,
      content: reply.content,
    });
    expect(requestDeepSeekReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Explain recursion",
        llmTask: "branch_chat",
        userPlan: "free",
      }),
    );
  });

  const invalidBodies: Array<[string, unknown]> = [
    ["missing instruction", { mode: "root" }],
    [
      "too many messages",
      {
        instruction: "hi",
        messages: Array.from({ length: 17 }, (_, index) => ({
          role: "user",
          content: `message ${index}`,
        })),
      },
    ],
    [
      "invalid message role",
      { instruction: "hi", messages: [{ role: "system", content: "x" }] },
    ],
  ];

  it.each(invalidBodies)("rejects an invalid body: %s", async (_label, body) => {
    const response = await postChat(body);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(requestDeepSeekReplyMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is hit", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const response = await postChat({ instruction: "hello" });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(requestDeepSeekReplyMock).not.toHaveBeenCalled();
  });

  it("rejects requests from an untrusted origin", async () => {
    const response = await postChat({ instruction: "hello" }, "https://evil.example");
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(requestDeepSeekReplyMock).not.toHaveBeenCalled();
  });
});
