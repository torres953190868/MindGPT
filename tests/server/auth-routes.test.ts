import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthCallbackUrl,
  sanitizeAuthNext,
} from "@/lib/server/auth-redirect";

const createSupabaseCookieClientMock = vi.hoisted(() => vi.fn());
const signInWithOtpMock = vi.hoisted(() => vi.fn());
const signInWithOAuthMock = vi.hoisted(() => vi.fn());
const signUpMock = vi.hoisted(() => vi.fn());
const signInWithPasswordMock = vi.hoisted(() => vi.fn());
const resetPasswordForEmailMock = vi.hoisted(() => vi.fn());
const updateUserMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const exchangeCodeForSessionMock = vi.hoisted(() => vi.fn());
const tryMigrateAnonymousDataToUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseCookieClient: createSupabaseCookieClientMock,
}));

vi.mock("@/lib/server/account-migration", () => ({
  tryMigrateAnonymousDataToUser: tryMigrateAnonymousDataToUserMock,
}));

function createJsonRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(url).origin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("auth redirects", () => {
  it("accepts relative app paths and rejects external URLs", () => {
    expect(sanitizeAuthNext("/projects")).toBe("/projects");
    expect(sanitizeAuthNext("/reader?document=doc_1#page-2")).toBe(
      "/reader?document=doc_1#page-2",
    );
    expect(sanitizeAuthNext("projects")).toBe("/projects");
    expect(sanitizeAuthNext("https://attacker.example/projects")).toBe("/projects");
    expect(sanitizeAuthNext("//attacker.example/projects")).toBe("/projects");
    expect(sanitizeAuthNext("/\\attacker.example/projects")).toBe("/projects");
  });

  it("builds a same-site callback URL with sanitized next", () => {
    const callbackUrl = new URL(
      buildAuthCallbackUrl("https://branchmind.example/api/auth/magic-link", "/reader"),
    );

    expect(callbackUrl.origin).toBe("https://branchmind.example");
    expect(callbackUrl.pathname).toBe("/auth/callback");
    expect(callbackUrl.searchParams.get("next")).toBe("/reader");
  });
});

describe("auth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseCookieClientMock.mockReset();
    signInWithOtpMock.mockReset();
    signInWithOAuthMock.mockReset();
    signUpMock.mockReset();
    signInWithPasswordMock.mockReset();
    resetPasswordForEmailMock.mockReset();
    updateUserMock.mockReset();
    getUserMock.mockReset();
    exchangeCodeForSessionMock.mockReset();
    tryMigrateAnonymousDataToUserMock.mockReset();
    tryMigrateAnonymousDataToUserMock.mockResolvedValue({
      ok: true,
      projectsUpdated: 0,
      documentsUpdated: 0,
      skipped: true,
    });
    createSupabaseCookieClientMock.mockResolvedValue({
      auth: {
        signInWithOtp: signInWithOtpMock,
        signInWithOAuth: signInWithOAuthMock,
        signUp: signUpMock,
        signInWithPassword: signInWithPasswordMock,
        resetPasswordForEmail: resetPasswordForEmailMock,
        updateUser: updateUserMock,
        getUser: getUserMock,
        exchangeCodeForSession: exchangeCodeForSessionMock,
      },
    });
  });

  it("passes a sanitized callback URL to Supabase magic-link auth", async () => {
    signInWithOtpMock.mockResolvedValue({ error: null });
    const { POST } = await import("@/app/api/auth/magic-link/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/magic-link", {
        email: "learner@example.com",
        next: "/reader?document=doc_1",
      }),
    );

    expect(response.status).toBe(200);
    expect(createSupabaseCookieClientMock).toHaveBeenCalledOnce();
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      options: {
        emailRedirectTo: expect.any(String),
      },
    });

    const redirectTo = new URL(
      signInWithOtpMock.mock.calls[0][0].options.emailRedirectTo,
    );
    expect(redirectTo.origin).toBe("https://branchmind.example");
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/reader?document=doc_1");
  });

  it("starts password sign-up with an email verification callback", async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const { POST } = await import("@/app/api/auth/sign-up/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/sign-up", {
        email: "Learner@Example.com",
        password: "correct horse battery",
        next: "/projects",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, verificationRequired: true });
    expect(signUpMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "correct horse battery",
      options: { emailRedirectTo: expect.any(String) },
    });
    const redirectTo = new URL(signUpMock.mock.calls[0][0].options.emailRedirectTo);
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/projects");
  });

  it("signs in with password and migrates anonymous browser data", async () => {
    const anonymousSessionId = "anon_session_12345678901234567890";
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: {
          id: "user_password",
          email: "learner@example.com",
          email_confirmed_at: "2026-05-16T00:00:00.000Z",
        },
      },
      error: null,
    });
    tryMigrateAnonymousDataToUserMock.mockResolvedValue({
      ok: true,
      projectsUpdated: 1,
      documentsUpdated: 2,
      skipped: false,
    });
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      createJsonRequest(
        "https://branchmind.example/api/auth/sign-in",
        {
          email: "Learner@Example.com",
          password: "correct horse battery",
          next: "/reader",
        },
        { Cookie: `branchmind_session=${anonymousSessionId}` },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      next: "/reader",
      migration: { ok: true, projectsUpdated: 1, documentsUpdated: 2 },
    });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "correct horse battery",
    });
    expect(tryMigrateAnonymousDataToUserMock).toHaveBeenCalledWith(
      anonymousSessionId,
      "user_password",
    );
  });

  it("rejects unverified password sign-ins without migrating data", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        user: {
          id: "user_unverified",
          email: "learner@example.com",
          email_confirmed_at: null,
        },
      },
      error: null,
    });
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/sign-in", {
        email: "learner@example.com",
        password: "correct horse battery",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("SIGN_IN_FAILED");
    expect(tryMigrateAnonymousDataToUserMock).not.toHaveBeenCalled();
  });

  it("starts password recovery without exposing account existence", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    const { POST } = await import("@/app/api/auth/forgot-password/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/forgot-password", {
        email: "Learner@Example.com",
        next: "/reader",
      }),
    );

    expect(response.status).toBe(200);
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: expect.any(String),
    });
    const redirectTo = new URL(resetPasswordForEmailMock.mock.calls[0][1].redirectTo);
    expect(redirectTo.pathname).toBe("/auth/callback");
    expect(redirectTo.searchParams.get("next")).toBe(
      "/auth/reset-password?next=%2Freader",
    );
  });

  it("updates password only with a valid recovery session", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "user_reset", email: "learner@example.com" } },
      error: null,
    });
    updateUserMock.mockResolvedValue({ data: { user: { id: "user_reset" } }, error: null });
    const { POST } = await import("@/app/api/auth/update-password/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/update-password", {
        password: "new correct horse",
        next: "/projects",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, next: "/projects" });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "new correct horse" });
  });

  it("validates origin and returns the Supabase Google OAuth URL", async () => {
    signInWithOAuthMock.mockResolvedValue({
      data: { url: "https://supabase.branchmind.example/auth/v1/authorize?provider=google" },
      error: null,
    });
    const { POST } = await import("@/app/api/auth/google/route");

    const response = await POST(
      createJsonRequest("https://branchmind.example/api/auth/google", {
        next: "/projects",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe(
      "https://supabase.branchmind.example/auth/v1/authorize?provider=google",
    );
    expect(createSupabaseCookieClientMock).toHaveBeenCalledOnce();
    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: expect.any(String),
      },
    });
  });

  it("rejects cross-site Google auth starts", async () => {
    const { POST } = await import("@/app/api/auth/google/route");

    const response = await POST(
      createJsonRequest(
        "https://branchmind.example/api/auth/google",
        { next: "/projects" },
        { Origin: "https://attacker.example" },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("falls back to projects for unsafe callback next paths", async () => {
    const { GET } = await import("@/app/auth/callback/route");

    const response = await GET(
      new NextRequest(
        "https://branchmind.example/auth/callback?next=https%3A%2F%2Fattacker.example%2Fsteal",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://branchmind.example/projects");
    expect(createSupabaseCookieClientMock).not.toHaveBeenCalled();
  });

  it("exchanges callback codes for a Supabase cookie session", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    const { GET } = await import("@/app/auth/callback/route");

    const response = await GET(
      new NextRequest(
        "https://branchmind.example/auth/callback?code=auth-code&next=%2Freader",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://branchmind.example/reader");
    expect(createSupabaseCookieClientMock).toHaveBeenCalledOnce();
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("auth-code");
  });

  it("migrates anonymous data after callback code exchange", async () => {
    const anonymousSessionId = "anon_session_12345678901234567890";
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user_callback" } },
      error: null,
    });
    const { GET } = await import("@/app/auth/callback/route");

    const response = await GET(
      new NextRequest(
        "https://branchmind.example/auth/callback?code=auth-code&next=%2Fprojects",
        { headers: { Cookie: `branchmind_session=${anonymousSessionId}` } },
      ),
    );

    expect(response.status).toBe(307);
    expect(tryMigrateAnonymousDataToUserMock).toHaveBeenCalledWith(
      anonymousSessionId,
      "user_callback",
    );
  });

  it("marks callback redirects when code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: new Error("PKCE failed") });
    const { GET } = await import("@/app/auth/callback/route");

    const response = await GET(
      new NextRequest(
        "https://branchmind.example/auth/callback?code=auth-code&next=%2Freader%3Fdocument%3Ddoc_1",
      ),
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(response.status).toBe(307);
    expect(location.origin).toBe("https://branchmind.example");
    expect(location.pathname).toBe("/reader");
    expect(location.searchParams.get("document")).toBe("doc_1");
    expect(location.searchParams.get("auth")).toBe("failed");
  });
});
