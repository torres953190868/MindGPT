import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    const user = await getOptionalSupabaseUser();
    return jsonWithSession(
      {
        configured: hasSupabaseServerConfig(),
        user: user ? { id: user.id, email: user.email ?? null } : null,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
