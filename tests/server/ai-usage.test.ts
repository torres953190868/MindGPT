import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";

const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());
const getSupabaseAccountPlanInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("@/lib/server/account-plan", () => ({
  getSupabaseAccountPlanInfo: getSupabaseAccountPlanInfoMock,
}));

import {
  getTodayAiMessageUsage,
  incrementDailyAiMessageUsage,
  listDailyAiMessageUsage,
  trackDailyAiMessageUsage,
} from "@/lib/server/ai-usage";

function createAdminClientMock() {
  const maybeSingle = vi.fn();
  const order = vi.fn();
  const gte = vi.fn(() => ({ order }));
  const eqUsageDate = vi.fn(() => ({ maybeSingle }));
  const eqUser = vi.fn(() => ({ eq: eqUsageDate, gte }));
  const select = vi.fn(() => ({ eq: eqUser }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn();

  return {
    client: { from, rpc },
    from,
    select,
    eqUser,
    eqUsageDate,
    maybeSingle,
    gte,
    order,
    rpc,
  };
}

function planInfoWithAiMessageLimit(limit: number | null) {
  return {
    plan: "free",
    displayName: null,
    languagePreference: "zh",
    subscriptionStatus: "inactive",
    limits: { projects: 5, nodes: 100, documents: 3, aiMessages: limit },
  };
}

describe("daily AI usage tracking", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hasSupabaseServerConfigMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    getSupabaseAccountPlanInfoMock.mockReset();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("trackDailyAiMessageUsage", () => {
    it("skips tracking for local-mode principals", async () => {
      const admin = createAdminClientMock();
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        trackDailyAiMessageUsage({ id: "session_local", authMode: "local" }),
      ).resolves.toBeUndefined();
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(getSupabaseAccountPlanInfoMock).not.toHaveBeenCalled();
    });

    it("skips tracking when Supabase is not configured", async () => {
      hasSupabaseServerConfigMock.mockReturnValue(false);
      const admin = createAdminClientMock();
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it("increments the counter and allows requests under the daily limit", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({ data: 10, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);
      getSupabaseAccountPlanInfoMock.mockResolvedValue(planInfoWithAiMessageLimit(50));

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
      expect(admin.rpc).toHaveBeenCalledWith("increment_daily_ai_usage", {
        p_user_id: "user_test",
      });
    });

    it("allows the request at exactly the daily limit", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({ data: 50, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);
      getSupabaseAccountPlanInfoMock.mockResolvedValue(planInfoWithAiMessageLimit(50));

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
    });

    it("throws a 429 HttpError when the increment passes the daily limit", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({ data: 51, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);
      getSupabaseAccountPlanInfoMock.mockResolvedValue(planInfoWithAiMessageLimit(50));

      const error = await trackDailyAiMessageUsage({
        id: "user_test",
        authMode: "supabase",
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(429);
      expect((error as HttpError).code).toBe("AI_MESSAGE_LIMIT_REACHED");
      expect((error as HttpError).expose).toBe(true);
      expect((error as HttpError).details).toEqual({ limit: 50 });
    });

    it("does not block plans with an unlimited AI message limit", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({ data: 9999, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);
      getSupabaseAccountPlanInfoMock.mockResolvedValue(planInfoWithAiMessageLimit(null));

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
    });

    it("fails open when the usage function is missing from the database", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the function public.increment_daily_ai_usage in the schema cache",
        },
      });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(getSupabaseAccountPlanInfoMock).not.toHaveBeenCalled();
    });

    it("fails open when the increment request throws", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockRejectedValue(new Error("connection refused"));
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        trackDailyAiMessageUsage({ id: "user_test", authMode: "supabase" }),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(getSupabaseAccountPlanInfoMock).not.toHaveBeenCalled();
    });
  });

  describe("incrementDailyAiMessageUsage", () => {
    it("returns the new counter value", async () => {
      const admin = createAdminClientMock();
      admin.rpc.mockResolvedValue({ data: 3, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(incrementDailyAiMessageUsage("user_test")).resolves.toBe(3);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns null without a Supabase config", async () => {
      hasSupabaseServerConfigMock.mockReturnValue(false);

      await expect(incrementDailyAiMessageUsage("user_test")).resolves.toBeNull();
      expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    });
  });

  describe("getTodayAiMessageUsage", () => {
    it("returns today's counter for the user", async () => {
      const admin = createAdminClientMock();
      admin.maybeSingle.mockResolvedValue({ data: { message_count: 7 }, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(getTodayAiMessageUsage("user_test")).resolves.toBe(7);
      expect(admin.from).toHaveBeenCalledWith("branchmind_daily_ai_usage");
      expect(admin.eqUser).toHaveBeenCalledWith("user_id", "user_test");
      expect(admin.eqUsageDate).toHaveBeenCalledWith(
        "usage_date",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    it("returns zero when there is no row for today", async () => {
      const admin = createAdminClientMock();
      admin.maybeSingle.mockResolvedValue({ data: null, error: null });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(getTodayAiMessageUsage("user_test")).resolves.toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns zero and warns when the usage table is missing", async () => {
      const admin = createAdminClientMock();
      admin.maybeSingle.mockResolvedValue({
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the table 'public.branchmind_daily_ai_usage' in the schema cache",
        },
      });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(getTodayAiMessageUsage("user_test")).resolves.toBe(0);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns zero without a Supabase config", async () => {
      hasSupabaseServerConfigMock.mockReturnValue(false);

      await expect(getTodayAiMessageUsage("user_test")).resolves.toBe(0);
      expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    });
  });

  describe("listDailyAiMessageUsage", () => {
    it("maps recent daily rows newest first", async () => {
      const admin = createAdminClientMock();
      admin.order.mockResolvedValue({
        data: [
          { usage_date: "2026-07-29", message_count: 5 },
          { usage_date: "2026-07-28", message_count: 2 },
        ],
        error: null,
      });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        listDailyAiMessageUsage("user_test", "2026-06-29"),
      ).resolves.toEqual([
        { date: "2026-07-29", messageCount: 5 },
        { date: "2026-07-28", messageCount: 2 },
      ]);
      expect(admin.eqUser).toHaveBeenCalledWith("user_id", "user_test");
      expect(admin.gte).toHaveBeenCalledWith("usage_date", "2026-06-29");
      expect(admin.order).toHaveBeenCalledWith("usage_date", { ascending: false });
    });

    it("returns an empty list and warns when the usage table is missing", async () => {
      const admin = createAdminClientMock();
      admin.order.mockResolvedValue({
        data: null,
        error: { code: "42P01", message: "relation \"public.branchmind_daily_ai_usage\" does not exist" },
      });
      getSupabaseAdminClientMock.mockReturnValue(admin.client);

      await expect(
        listDailyAiMessageUsage("user_test", "2026-06-29"),
      ).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("returns an empty list without a Supabase config", async () => {
      hasSupabaseServerConfigMock.mockReturnValue(false);

      await expect(
        listDailyAiMessageUsage("user_test", "2026-06-29"),
      ).resolves.toEqual([]);
      expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    });
  });
});
