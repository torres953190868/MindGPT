import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { jsonWithSession, safeErrorWithSession, HttpError } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import { requireSupabaseServerConfig } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/server/validation";

const magicLinkSchema = z.object({
  email: z.string().trim().email().max(320),
});

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });
    const { email } = await parseJsonBody(request, magicLinkSchema, {
      maxBytes: 4 * 1024,
    });
    const config = requireSupabaseServerConfig();
    const supabase = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const redirectTo = new URL("/auth/callback", request.url).toString();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      throw new HttpError("Unable to send sign-in email.", {
        code: "MAGIC_LINK_FAILED",
        status: 502,
      });
    }

    return jsonWithSession({ ok: true }, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
