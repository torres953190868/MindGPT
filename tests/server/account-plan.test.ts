import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlanModelAccess } from "@/lib/server/account-plan";

const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

describe("getPlanModelAccess", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns an empty list for unrestricted plans", async () => {
    const access = await getPlanModelAccess("pro");
    expect(access).toEqual([]);
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns the static DeepSeek fallback in local/dev mode", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(false);

    const access = await getPlanModelAccess("free");

    expect(access).toEqual([
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-pro" },
    ]);
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("returns DB rows when the table is populated", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    getSupabaseAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  plan: "free",
                  provider_id: "deepseek",
                  model: "deepseek-v4-flash",
                  created_at: "2026-06-30T00:00:00.000Z",
                  updated_at: "2026-06-30T00:00:00.000Z",
                },
              ],
              error: null,
            }),
          ),
        })),
      })),
    });

    const access = await getPlanModelAccess("free");

    expect(access).toEqual([
      {
        plan: "free",
        providerId: "deepseek",
        model: "deepseek-v4-flash",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ]);
  });

  it("falls back to static DeepSeek models when the DB query fails", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getSupabaseAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: new Error("connection refused"),
            }),
          ),
        })),
      })),
    });

    const access = await getPlanModelAccess("free");

    expect(access).toEqual([
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-pro" },
    ]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "BranchMind plan model access lookup failed",
      expect.objectContaining({
        plan: "free",
        table: "branchmind_plan_model_access",
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("falls back to static DeepSeek models when the DB table has no rows", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    getSupabaseAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    });

    const access = await getPlanModelAccess("free");

    expect(access).toEqual([
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-flash" },
      { plan: "free", providerId: "deepseek", model: "deepseek-v4-pro" },
    ]);
  });
});
