import type { NextRequest, NextResponse } from "next/server";

export type BranchMindSession = {
  id: string;
  isNew: boolean;
};

export const SESSION_COOKIE_NAME = "branchmind_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24,96}$/;

function createSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function getOrCreateSession(request: NextRequest): BranchMindSession {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (cookieValue && SESSION_ID_PATTERN.test(cookieValue)) {
    return { id: cookieValue, isNew: false };
  }

  return { id: createSessionId(), isNew: true };
}

export function getExistingSessionId(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return cookieValue && SESSION_ID_PATTERN.test(cookieValue) ? cookieValue : null;
}

export function commitSessionCookie(
  response: NextResponse,
  session: BranchMindSession,
) {
  if (!session.isNew) return response;

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
