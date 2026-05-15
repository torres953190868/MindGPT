import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthCallbackUrl,
  sanitizeAuthNext,
} from "@/lib/server/auth-redirect";

const createClientMock = vi.hoisted(() => vi.fn());
const signInWithOtpMock = vi.hoisted(() => vi.fn());
const signInWithOAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

const originalSupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function setSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.branchmind.example";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon_test_key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test_key";
}

function restoreSupabaseEnv() {
  for (const [key, value] of Object.entries(originalSupabaseEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

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
    setSupabaseEnv();
    createClientMock.mockReset();
    signInWithOtpMock.mockReset();
    signInWithOAuthMock.mockReset();
    createClientMock.mockReturnValue({
      auth: {
        signInWithOtp: signInWithOtpMock,
        signInWithOAuth: signInWithOAuthMock,
      },
    });
  });

  afterEach(() => {
    restoreSupabaseEnv();
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
  });
});
