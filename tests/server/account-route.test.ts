import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OriginValidationError } from "@/lib/server/security";

const assertValidRequestOriginMock = vi.hoisted(() => vi.fn());
const checkRateLimitAsyncMock = vi.hoisted(() => vi.fn());
const getOptionalSupabaseUserMock = vi.hoisted(() => vi.fn());
const getOrCreateSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session_test", isNew: false })),
);
const hasSupabaseServerConfigMock = vi.hoisted(() => vi.fn());
const getSupabaseAccountPlanInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({
  getBranchMindAuthContext: vi.fn(),
  getOptionalSupabaseUser: getOptionalSupabaseUserMock,
}));

vi.mock("@/lib/server/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/session")>();
  return {
    ...actual,
    getExistingSessionId: vi.fn(),
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
  getSupabaseAdminClient: vi.fn(() => createSupabaseAdminClientMock()),
  createSupabaseCookieClient: vi.fn(),
}));

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
