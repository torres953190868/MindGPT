import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildAuthCallbackUrl } from "@/lib/server/auth-redirect";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { createSupabaseCookieClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/server/validation";

const googleAuthSchema = z.object({
  next: z.string().trim().max(2048).optional(),
});

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { next } = await parseJsonBody(request, googleAuthSchema, {
      maxBytes: 4 * 1024,
    });
    const supabase = await createSupabaseCookieClient();
    const redirectTo = buildAuthCallbackUrl(request.url, next);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error || !data.url) {
      throw new HttpError("Unable to start Google sign-in.", {
        code: "GOOGLE_AUTH_FAILED",
        status: 502,
      });
    }

    return jsonWithSession({ url: data.url }, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
