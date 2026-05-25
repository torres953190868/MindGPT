import type { NextRequest } from "next/server";
import { safeErrorWithSession, HttpError } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    throw new HttpError("Email sign-in is disabled.", {
      code: "EMAIL_AUTH_DISABLED",
      expose: true,
      status: 410,
    });
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
