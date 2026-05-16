import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthCallbackUrl,
  sanitizeAuthNext,
} from "@/lib/server/auth-redirect";

const createSupabaseCookieClientMock = vi.hoisted(() => vi.fn());
const signInWithOtpMock = vi.hoisted(() => vi.fn());
const signInWithOAuthMock = vi.hoisted(() => vi.fn());
const exchangeCodeForSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseCookieClient: createSupabaseCookieClientMock,
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
    exchangeCodeForSessionMock.mockReset();
    createSupabaseCookieClientMock.mockResolvedValue({
      auth: {
        signInWithOtp: signInWithOtpMock,
        signInWithOAuth: signInWithOAuthMock,
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
