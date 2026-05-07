import type { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE_NAME,
  commitSessionCookie,
  getOrCreateSession,
} from "@/lib/server/session";

function requestWithCookie(value?: string) {
  return {
    cookies: {
      get: vi.fn((name: string) =>
        name === SESSION_COOKIE_NAME && value ? { value } : undefined,
      ),
    },
  } as unknown as NextRequest;
}

describe("session helpers", () => {
  it("reuses valid anonymous session cookies", () => {
    const existingId = "abcDEF123_-abcDEF123_-abcDEF123_";

    expect(getOrCreateSession(requestWithCookie(existingId))).toEqual({
      id: existingId,
      isNew: false,
    });
  });

  it("replaces missing or malformed session cookies", () => {
    const missing = getOrCreateSession(requestWithCookie());
    const malformed = getOrCreateSession(requestWithCookie("bad cookie"));

    expect(missing).toMatchObject({ isNew: true });
    expect(missing.id).toMatch(/^[A-Za-z0-9_-]{24,96}$/);
    expect(malformed).toMatchObject({ isNew: true });
    expect(malformed.id).toMatch(/^[A-Za-z0-9_-]{24,96}$/);
    expect(malformed.id).not.toBe("bad cookie");
  });

  it("commits cookies only for new sessions", () => {
    const setCookie = vi.fn();
    const response = {
      cookies: { set: setCookie },
    } as unknown as NextResponse;

    expect(
      commitSessionCookie(response, { id: "session-id", isNew: true }),
    ).toBe(response);
    expect(setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOnly: true,
        maxAge: 31_536_000,
        name: SESSION_COOKIE_NAME,
        path: "/",
        sameSite: "lax",
        value: "session-id",
      }),
    );

    setCookie.mockClear();
    commitSessionCookie(response, { id: "session-id", isNew: false });
    expect(setCookie).not.toHaveBeenCalled();
  });
});
