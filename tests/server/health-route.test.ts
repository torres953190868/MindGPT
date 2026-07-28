import { beforeEach, describe, expect, it, vi } from "vitest";

const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdminClient: () => ({
    from: fromMock,
  }),
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
}));

describe("health route", () => {
  beforeEach(() => {
    hasSupabaseServerConfigMock.mockReset();
    selectMock.mockReset();
    fromMock.mockReset();
    fromMock.mockReturnValue({ select: selectMock });
  });

  it("reports ok with a skipped probe when Supabase is not configured", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(false);
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body.ok).toBe(true);
    expect(body.checks.supabase).toBe("not_configured");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("probes a core table when Supabase is configured", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    selectMock.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.supabase).toBe("ok");
    expect(fromMock).toHaveBeenCalledWith("branchmind_projects");
    expect(selectMock).toHaveBeenCalledWith("id", { head: true });
  });

  it("returns 503 when the Supabase probe fails", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    selectMock.mockResolvedValue({ error: { message: "connection refused" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/health/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.supabase).toBe("error");
    expect(JSON.stringify(body)).not.toContain("connection refused");
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
