import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalSupabaseUserMock = vi.hoisted(() => vi.fn());
const applyAdminLlmConfigActionMock = vi.hoisted(() => vi.fn());
const updateAdminBugReportMock = vi.hoisted(() => vi.fn());

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
