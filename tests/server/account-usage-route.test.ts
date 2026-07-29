import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalSupabaseUserMock = vi.hoisted(() => vi.fn());
const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const listDailyAiMessageUsageMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getOptionalSupabaseUser: getOptionalSupabaseUserMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
}));

vi.mock("@/lib/server/ai-usage", () => ({
  listDailyAiMessageUsage: listDailyAiMessageUsageMock,
}));

function createGetRequest() {
  return new NextRequest("https://branchmind.example/api/account/usage", {
    method: "GET",
  });
}

describe("GET /api/account/usage", () => {
  beforeEach(() => {
    vi.resetModules();
    getOptionalSupabaseUserMock.mockReset();
    hasSupabaseServerConfigMock.mockReset();
    listDailyAiMessageUsageMock.mockReset();

    hasSupabaseServerConfigMock.mockReturnValue(true);
    getOptionalSupabaseUserMock.mockResolvedValue({
      id: "user_test",
      email: "learner@example.com",
    });
    listDailyAiMessageUsageMock.mockResolvedValue([]);
  });

  it("returns the last 30 days of daily AI message counts", async () => {
    listDailyAiMessageUsageMock.mockResolvedValue([
      { date: "2026-07-29", messageCount: 5 },
      { date: "2026-07-28", messageCount: 2 },
    ]);
    const { GET } = await import("@/app/api/account/usage/route");

    const response = await GET(createGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listDailyAiMessageUsageMock).toHaveBeenCalledWith(
      "user_test",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(body.history).toEqual([
      {
        date: "2026-07-29",
        projectCount: 0,
        nodeCount: 0,
        documentCount: 0,
        aiMessageCount: 5,
      },
      {
        date: "2026-07-28",
        projectCount: 0,
        nodeCount: 0,
        documentCount: 0,
        aiMessageCount: 2,
      },
    ]);
  });

  it("returns an empty history when daily tracking is unavailable", async () => {
    // listDailyAiMessageUsage fails open to [] when the usage table is missing.
    listDailyAiMessageUsageMock.mockResolvedValue([]);
    const { GET } = await import("@/app/api/account/usage/route");

    const response = await GET(createGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.history).toEqual([]);
  });

  it("returns an empty history for guests", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/account/usage/route");

    const response = await GET(createGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.history).toEqual([]);
    expect(listDailyAiMessageUsageMock).not.toHaveBeenCalled();
  });

  it("returns an empty history without Supabase config or a session", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(false);
    const { GET } = await import("@/app/api/account/usage/route");

    const response = await GET(createGetRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.history).toEqual([]);
    expect(listDailyAiMessageUsageMock).not.toHaveBeenCalled();
  });
});
