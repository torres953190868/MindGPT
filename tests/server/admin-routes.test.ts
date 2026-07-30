import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalSupabaseUserMock = vi.hoisted(() => vi.fn());
const applyAdminLlmConfigActionMock = vi.hoisted(() => vi.fn());
const updateAdminBugReportMock = vi.hoisted(() => vi.fn());
const listAdminUsersMock = vi.hoisted(() => vi.fn());
const resetAdminUserPasswordMock = vi.hoisted(() => vi.fn());
const getAdminAnalyticsMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getOptionalSupabaseUser: getOptionalSupabaseUserMock,
}));

vi.mock("@/lib/server/admin-llm-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/admin-llm-config")>();

  return {
    ...actual,
    applyAdminLlmConfigAction: applyAdminLlmConfigActionMock,
  };
});

vi.mock("@/lib/server/bug-reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/bug-reports")>();

  return {
    ...actual,
    updateAdminBugReport: updateAdminBugReportMock,
  };
});

vi.mock("@/lib/server/admin-users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/admin-users")>();

  return {
    ...actual,
    listAdminUsers: listAdminUsersMock,
    resetAdminUserPassword: resetAdminUserPasswordMock,
  };
});

vi.mock("@/lib/server/admin-analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/admin-analytics")>();

  return {
    ...actual,
    getAdminAnalytics: getAdminAnalyticsMock,
  };
});

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/llm-router", () => ({
  getAdminLlmConfig: vi.fn(async () => ({
    models: [],
    providers: [],
    routes: [],
    source: "database",
  })),
}));

const originalAdminEmails = process.env.BRANCHMIND_ADMIN_EMAILS;

function adminUser() {
  return {
    id: "admin_user",
    email: "admin@branchmind.example",
  };
}

function llmConfigRequest(origin: string) {
  return new NextRequest("https://branchmind.example/api/admin/llm-config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({
      action: "setProviderEnabled",
      providerId: "deepseek",
      enabled: false,
    }),
  });
}

function bugReportPatchRequest(origin: string) {
  return new NextRequest(
    "https://branchmind.example/api/admin/bug-reports/report_admin",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({
        status: "triaged",
        adminNotes: "Reviewed by admin.",
      }),
    },
  );
}

describe("admin mutation routes", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BRANCHMIND_ADMIN_EMAILS = "admin@branchmind.example";
    getOptionalSupabaseUserMock.mockReset();
    applyAdminLlmConfigActionMock.mockReset();
    updateAdminBugReportMock.mockReset();
    getOptionalSupabaseUserMock.mockResolvedValue(adminUser());
    applyAdminLlmConfigActionMock.mockResolvedValue({
      models: [],
      providers: [],
      routes: [],
      source: "database",
    });
    updateAdminBugReportMock.mockResolvedValue({
      id: "report_admin",
      title: "Broken flow",
      description: "The workspace got stuck.",
      status: "triaged",
      contactEmail: null,
      currentUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      reporterUserId: "user_reporter",
      reporterEmail: "reporter@example.com",
      userAgent: null,
      screenshotPath: null,
      screenshotUrl: null,
      adminNotes: "Reviewed by admin.",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.BRANCHMIND_ADMIN_EMAILS;
    } else {
      process.env.BRANCHMIND_ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it("rejects cross-site LLM config mutations before applying changes", async () => {
    const { POST } = await import("@/app/api/admin/llm-config/route");

    const response = await POST(llmConfigRequest("https://attacker.example"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(applyAdminLlmConfigActionMock).not.toHaveBeenCalled();
  });

  it("allows same-origin LLM config mutations for admins", async () => {
    const { POST } = await import("@/app/api/admin/llm-config/route");

    const response = await POST(llmConfigRequest("https://branchmind.example"));

    expect(response.status).toBe(200);
    expect(applyAdminLlmConfigActionMock).toHaveBeenCalledWith({
      action: "setProviderEnabled",
      providerId: "deepseek",
      enabled: false,
    });
  });

  it("rejects cross-site bug-report mutations before applying changes", async () => {
    const { PATCH } = await import("@/app/api/admin/bug-reports/[id]/route");

    const response = await PATCH(bugReportPatchRequest("https://attacker.example"), {
      params: Promise.resolve({ id: "report_admin" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(updateAdminBugReportMock).not.toHaveBeenCalled();
  });

  it("allows same-origin bug-report mutations for admins", async () => {
    const { PATCH } = await import("@/app/api/admin/bug-reports/[id]/route");

    const response = await PATCH(bugReportPatchRequest("https://branchmind.example"), {
      params: Promise.resolve({ id: "report_admin" }),
    });

    expect(response.status).toBe(200);
    expect(updateAdminBugReportMock).toHaveBeenCalledWith("report_admin", {
      status: "triaged",
      adminNotes: "Reviewed by admin.",
    });
  });
});

function adminUsersRequest(queryString = "") {
  return new NextRequest(`https://branchmind.example/api/admin/users${queryString}`);
}

function adminAnalyticsRequest(queryString = "") {
  return new NextRequest(
    `https://branchmind.example/api/admin/analytics${queryString}`,
  );
}

function resetPasswordRequest(origin: string, password: string) {
  return new NextRequest(
    "https://branchmind.example/api/admin/users/user_target/password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ password }),
    },
  );
}

function adminAnalyticsDto(rangeDays: 7 | 30) {
  return {
    rangeDays,
    generatedAt: "2026-07-29T00:00:00.000Z",
    totals: { users: 4, projects: 3, nodes: 9, userMessages: 12, documents: 2 },
    growth: {
      signups: [],
      planDistribution: { free: 3, pro: 1, max: 0 },
      subscriptionStatusCounts: { active: 1, inactive: 3 },
    },
    activity: { dau: 1, wau: 2, dailyActive: [], topUsers: [] },
    features: {
      branchSplit: {
        continueCount: 6,
        branchCount: 3,
        continueShare: 2 / 3,
        branchShare: 1 / 3,
      },
      dailyProjects: [],
      dailyNodes: [],
      dailyDocuments: [],
    },
  };
}

describe("admin user and analytics routes", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BRANCHMIND_ADMIN_EMAILS = "admin@branchmind.example";
    getOptionalSupabaseUserMock.mockReset();
    listAdminUsersMock.mockReset();
    resetAdminUserPasswordMock.mockReset();
    getAdminAnalyticsMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getOptionalSupabaseUserMock.mockResolvedValue(adminUser());
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    listAdminUsersMock.mockResolvedValue({ users: [], total: 0, truncated: false });
    resetAdminUserPasswordMock.mockResolvedValue(undefined);
    getAdminAnalyticsMock.mockResolvedValue(adminAnalyticsDto(30));
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.BRANCHMIND_ADMIN_EMAILS;
    } else {
      process.env.BRANCHMIND_ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it("rejects anonymous user list requests", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/users/route");

    const response = await GET(adminUsersRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(listAdminUsersMock).not.toHaveBeenCalled();
  });

  it("rejects user list requests from non-admins", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue({
      id: "user_regular",
      email: "user@example.com",
    });
    const { GET } = await import("@/app/api/admin/users/route");

    const response = await GET(adminUsersRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ADMIN_REQUIRED");
    expect(listAdminUsersMock).not.toHaveBeenCalled();
  });

  it("lists users for admins", async () => {
    const { GET } = await import("@/app/api/admin/users/route");

    const response = await GET(adminUsersRequest("?page=2&query=ali"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ users: [], total: 0, truncated: false });
    expect(listAdminUsersMock).toHaveBeenCalledWith({
      page: 2,
      perPage: 50,
      query: "ali",
    });
  });

  it("rejects invalid user list pages", async () => {
    const { GET } = await import("@/app/api/admin/users/route");

    const response = await GET(adminUsersRequest("?page=abc"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("ADMIN_USERS_PAGE_INVALID");
    expect(listAdminUsersMock).not.toHaveBeenCalled();
  });

  it("rejects analytics requests with invalid day ranges", async () => {
    const { GET } = await import("@/app/api/admin/analytics/route");

    const response = await GET(adminAnalyticsRequest("?days=13"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("ADMIN_ANALYTICS_DAYS_INVALID");
    expect(getAdminAnalyticsMock).not.toHaveBeenCalled();
  });

  it("returns analytics for admins", async () => {
    getAdminAnalyticsMock.mockResolvedValue(adminAnalyticsDto(7));
    const { GET } = await import("@/app/api/admin/analytics/route");

    const response = await GET(adminAnalyticsRequest("?days=7"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analytics.rangeDays).toBe(7);
    expect(getAdminAnalyticsMock).toHaveBeenCalledWith(7);
  });

  it("rejects anonymous password resets", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/admin/users/[userId]/password/route");

    const response = await POST(
      resetPasswordRequest("https://branchmind.example", "brand-new-password"),
      { params: Promise.resolve({ userId: "user_target" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(resetAdminUserPasswordMock).not.toHaveBeenCalled();
  });

  it("rejects password resets from non-admins", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue({
      id: "user_regular",
      email: "user@example.com",
    });
    const { POST } = await import("@/app/api/admin/users/[userId]/password/route");

    const response = await POST(
      resetPasswordRequest("https://branchmind.example", "brand-new-password"),
      { params: Promise.resolve({ userId: "user_target" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ADMIN_REQUIRED");
    expect(resetAdminUserPasswordMock).not.toHaveBeenCalled();
  });

  it("rejects short passwords before calling the admin API", async () => {
    const { POST } = await import("@/app/api/admin/users/[userId]/password/route");

    const response = await POST(
      resetPasswordRequest("https://branchmind.example", "short"),
      { params: Promise.resolve({ userId: "user_target" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(resetAdminUserPasswordMock).not.toHaveBeenCalled();
  });

  it("resets passwords for admins", async () => {
    const { POST } = await import("@/app/api/admin/users/[userId]/password/route");

    const response = await POST(
      resetPasswordRequest("https://branchmind.example", "brand-new-password"),
      { params: Promise.resolve({ userId: "user_target" }) },
    );

    expect(response.status).toBe(200);
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "admin-reset-password",
        limit: 10,
        windowMs: 60_000,
      }),
    );
    expect(resetAdminUserPasswordMock).toHaveBeenCalledWith(
      "user_target",
      "brand-new-password",
    );
  });
});
