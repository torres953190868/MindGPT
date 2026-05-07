import type { NextRequest } from "next/server";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { assertValidRequestOrigin } from "@/lib/server/security";
import { getOrCreateSession } from "@/lib/server/session";
import {
  createSupabaseCookieClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    assertValidRequestOrigin(request, {
      allowMissingOrigin: process.env.NODE_ENV !== "production",
    });

    if (hasSupabaseServerConfig()) {
      const supabase = await createSupabaseCookieClient();
      await supabase.auth.signOut();
    }

    return jsonWithSession({ ok: true }, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
