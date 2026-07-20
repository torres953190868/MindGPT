import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OriginValidationError } from "@/lib/server/security";

const assertValidRequestOriginMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());
const getOptionalSupabaseUserMock = vi.hoisted(() => vi.fn());
const getOrCreateSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session_test", isNew: false })),
);
const getExistingSessionIdMock = vi.hoisted(() => vi.fn());
const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const getSupabaseAccountPlanInfoMock = vi.hoisted(() => vi.fn());
const getSupabaseAdminClientMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
const createSupabaseCookieClientMock = vi.hoisted(() => vi.fn());
const getRagRepositoryMock = vi.hoisted(() => vi.fn());
const projectsStoreMock = vi.hoisted(() => ({
  readProjectsForSession: vi.fn(),
  updateProjects: vi.fn(),
  projectBelongsToSession: vi.fn(
    (project: { ownerSessionId?: string }, sessionId: string) =>
      project.ownerSessionId === sessionId,
  ),
}));

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(),
  getOptionalSupabaseUser: getOptionalSupabaseUserMock,
}));

vi.mock("@/lib/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/session")>();
  return {
    ...actual,
    getExistingSessionId: getExistingSessionIdMock,
    getOrCreateSession: getOrCreateSessionMock,
  };
});

vi.mock("@/lib/server/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/security")>();
  return {
    ...actual,
    assertValidRequestOrigin: assertValidRequestOriginMock,
    validateRequestOrigin: vi.fn(),
  };
});

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  checkRateLimitAsync: checkRateLimitAsyncMock,
}));

vi.mock("@/lib/server/account-plan", () => ({
  DEFAULT_ACCOUNT_PLAN: "free",
  DEFAULT_PLAN_LIMITS: {
    free: {
      projects: 5,
      nodes: 100,
      documents: 3,
      aiMessages: 50,
    },
    pro: {
      projects: null,
      nodes: null,
      documents: 50,
      aiMessages: 500,
    },
    max: {
      projects: null,
      nodes: null,
      documents: null,
      aiMessages: null,
    },
  },
  PLAN_LIMITS_DISABLED: {
    projects: null,
    nodes: null,
    documents: null,
    aiMessages: null,
  },
  getSupabaseAccountPlanInfo: getSupabaseAccountPlanInfoMock,
  getAccountPlanForModelAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  getSupabaseAdminClient: getSupabaseAdminClientMock,
  createSupabaseCookieClient: createSupabaseCookieClientMock,
}));

vi.mock("@/lib/server/rag/store", () => ({
  getRagRepository: getRagRepositoryMock,
}));

vi.mock("@/lib/server/projects-store", () => projectsStoreMock);

function createSupabaseAdminClientMock() {
  const chain = {
    eq: vi.fn(() => Promise.resolve({ data: [], count: 0, error: null })),
    in: vi.fn(() => Promise.resolve({ data: [], count: 0, error: null })),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => chain),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  };
}

function createPatchRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("https://branchmind.example/api/account", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://branchmind.example",
    },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/account", () => {
  beforeEach(() => {
    vi.resetModules();
    assertValidRequestOriginMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getOptionalSupabaseUserMock.mockReset();
    getSupabaseAccountPlanInfoMock.mockReset();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    getSupabaseAdminClientMock.mockImplementation(() => createSupabaseAdminClientMock());

    assertValidRequestOriginMock.mockReturnValue({
      allowed: true,
      origin: "https://branchmind.example",
      source: "origin",
    });
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      storage: "map",
    });
    getOptionalSupabaseUserMock.mockResolvedValue({
      id: "user_test",
      email: "learner@example.com",
    });
    getSupabaseAccountPlanInfoMock.mockResolvedValue({
      plan: "free",
      displayName: "Learner",
      languagePreference: "zh",
      subscriptionStatus: "inactive",
      limits: {
        projects: 5,
        nodes: 100,
        documents: 3,
        aiMessages: 50,
      },
    });
  });

  it("rejects cross-origin PATCH requests with 403", async () => {
    assertValidRequestOriginMock.mockImplementation(() => {
      throw new OriginValidationError("Request origin is not allowed.");
    });
    const { PATCH } = await import("@/app/api/account/route");

    const response = await PATCH(createPatchRequest({ displayName: "New Name" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(checkRateLimitAsyncMock).not.toHaveBeenCalled();
  });

  it("allows same-origin PATCH requests to update account data", async () => {
    const { PATCH } = await import("@/app/api/account/route");

    const response = await PATCH(createPatchRequest({ displayName: "New Name" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.displayName).toBe("Learner");
    expect(assertValidRequestOriginMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { allowMissingOrigin: true },
    );
  });

  it("allows missing origin in non-production environments", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    assertValidRequestOriginMock.mockReturnValue({
      allowed: true,
      source: "missing",
    });
    const { PATCH } = await import("@/app/api/account/route");

    const response = await PATCH(createPatchRequest({ displayName: "New Name" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.displayName).toBe("Learner");
    expect(assertValidRequestOriginMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { allowMissingOrigin: true },
    );

    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it("returns 429 with Retry-After when the rate limit is exceeded", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
      storage: "map",
    });
    const { PATCH } = await import("@/app/api/account/route");

    const response = await PATCH(createPatchRequest({ displayName: "New Name" }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });

  it("calls the rate limiter with the authenticated user id", async () => {
    const { PATCH } = await import("@/app/api/account/route");

    await PATCH(createPatchRequest({ displayName: "New Name" }));

    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "patch-account",
        sessionId: "user_test",
        limit: 120,
        windowMs: 60_000,
      }),
    );
  });
});

function createDeleteRequest() {
  return new NextRequest("https://branchmind.example/api/account", {
    method: "DELETE",
    headers: {
      Origin: "https://branchmind.example",
    },
  });
}

function createDeleteAdminClientMock() {
  const projectDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
  const bugReportSelectEq = vi.fn(() =>
    Promise.resolve({ data: [{ screenshot_path: "2026-07-17/shot.png" }], error: null }),
  );
  const bugReportDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
  const rateLimitDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
  const storageRemove = vi.fn(() => Promise.resolve({ data: [], error: null }));
  const deleteUser = vi.fn(() => Promise.resolve({ error: null }));

  const client = {
    from: vi.fn((table: string) => {
      if (table === "branchmind_projects") {
        return { delete: vi.fn(() => ({ eq: projectDeleteEq })) };
      }
      if (table === "branchmind_bug_reports") {
        return {
          select: vi.fn(() => ({ eq: bugReportSelectEq })),
          delete: vi.fn(() => ({ eq: bugReportDeleteEq })),
        };
      }
      if (table === "rate_limits") {
        return { delete: vi.fn(() => ({ eq: rateLimitDeleteEq })) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({ remove: storageRemove })),
    },
    auth: {
      admin: { deleteUser },
    },
  };

  return {
    client,
    projectDeleteEq,
    bugReportSelectEq,
    bugReportDeleteEq,
    rateLimitDeleteEq,
    storageRemove,
    deleteUser,
  };
}

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.resetModules();
    assertValidRequestOriginMock.mockReset();
    checkRateLimitAsyncMock.mockReset();
    getOptionalSupabaseUserMock.mockReset();
    getExistingSessionIdMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    signOutMock.mockReset();
    createSupabaseCookieClientMock.mockReset();
    getRagRepositoryMock.mockReset();
    projectsStoreMock.readProjectsForSession.mockReset();
    projectsStoreMock.updateProjects.mockReset();
    projectsStoreMock.projectBelongsToSession.mockClear();

    assertValidRequestOriginMock.mockReturnValue({
      allowed: true,
      origin: "https://branchmind.example",
      source: "origin",
    });
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      storage: "map",
    });
    getOptionalSupabaseUserMock.mockResolvedValue({
      id: "user_test",
      email: "learner@example.com",
    });
    hasSupabaseServerConfigMock.mockReturnValue(true);
    signOutMock.mockResolvedValue({});
    createSupabaseCookieClientMock.mockResolvedValue({
      auth: { signOut: signOutMock },
    });
    getRagRepositoryMock.mockReturnValue({
      listDocuments: vi.fn(async () => []),
      deleteDocument: vi.fn(async () => undefined),
    });
  });

  it("deletes all user data and the auth user in supabase mode", async () => {
    const admin = createDeleteAdminClientMock();
    getSupabaseAdminClientMock.mockReturnValue(admin.client);
    const documents = [{ id: "doc_1" }, { id: "doc_2" }];
    const listDocuments = vi.fn(async () => documents);
    const deleteDocument = vi.fn(async () => undefined);
    getRagRepositoryMock.mockReturnValue({ listDocuments, deleteDocument });
    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "delete-account",
        sessionId: "user_test",
        limit: 5,
        windowMs: 600_000,
      }),
    );
    expect(admin.projectDeleteEq).toHaveBeenCalledWith("owner_session_id", "user_test");
    expect(listDocuments).toHaveBeenCalledWith("user_test");
    expect(deleteDocument).toHaveBeenCalledTimes(2);
    expect(deleteDocument).toHaveBeenNthCalledWith(1, documents[0]);
    expect(admin.bugReportSelectEq).toHaveBeenCalledWith("reporter_user_id", "user_test");
    expect(admin.bugReportDeleteEq).toHaveBeenCalledWith("reporter_user_id", "user_test");
    expect(admin.client.storage.from).toHaveBeenCalledWith("branchmind-bug-attachments");
    expect(admin.storageRemove).toHaveBeenCalledWith(["2026-07-17/shot.png"]);
    expect(admin.rateLimitDeleteEq).toHaveBeenCalledWith("session_id", "user_test");
    expect(admin.deleteUser).toHaveBeenCalledWith("user_test");
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when no supabase user is signed in", async () => {
    getOptionalSupabaseUserMock.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(getSupabaseAdminClientMock).not.toHaveBeenCalled();
    expect(checkRateLimitAsyncMock).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the delete rate limit is exceeded", async () => {
    checkRateLimitAsyncMock.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
      storage: "map",
    });
    const admin = createDeleteAdminClientMock();
    getSupabaseAdminClientMock.mockReturnValue(admin.client);
    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("rejects cross-origin DELETE requests with 403", async () => {
    assertValidRequestOriginMock.mockImplementation(() => {
      throw new OriginValidationError("Request origin is not allowed.");
    });
    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(checkRateLimitAsyncMock).not.toHaveBeenCalled();
  });

  it("wipes session-owned data and expires the session cookie in local mode", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(false);
    getExistingSessionIdMock.mockReturnValue("session_local");
    const documents = [{ id: "doc_1" }];
    const listDocuments = vi.fn(async () => documents);
    const deleteDocument = vi.fn(async () => undefined);
    getRagRepositoryMock.mockReturnValue({ listDocuments, deleteDocument });

    let remainingProjects: unknown;
    projectsStoreMock.updateProjects.mockImplementation(
      async (updater: (projects: Array<{ ownerSessionId: string }>) => unknown) => {
        remainingProjects = updater([
          { ownerSessionId: "session_local" },
          { ownerSessionId: "other_session" },
        ]);
        return remainingProjects;
      },
    );

    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(remainingProjects).toEqual([{ ownerSessionId: "other_session" }]);
    expect(listDocuments).toHaveBeenCalledWith("session_local");
    expect(deleteDocument).toHaveBeenCalledWith(documents[0]);
    expect(response.headers.get("set-cookie")).toMatch(/branchmind_session=/);
    expect(response.headers.get("set-cookie")).toMatch(/max-age=0/i);
    expect(checkRateLimitAsyncMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "delete-account",
        sessionId: "session_local",
      }),
    );
  });

  it("returns 401 in local mode when there is no session cookie", async () => {
    hasSupabaseServerConfigMock.mockReturnValue(false);
    getExistingSessionIdMock.mockReturnValue(null);
    const { DELETE } = await import("@/app/api/account/route");

    const response = await DELETE(createDeleteRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(projectsStoreMock.updateProjects).not.toHaveBeenCalled();
  });
});
