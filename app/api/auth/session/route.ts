import type { NextRequest } from "next/server";
import { getOptionalSupabaseUser } from "@/lib/server/auth";
import {
  getSupabaseUserAccountName,
  getSupabaseUserPublicEmail,
} from "@/lib/server/auth-password";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession(
        {
          configured: false,
          user: null,
        },
        READ_ONLY_LOCAL_SESSION,
      );
    }

    const user = await getOptionalSupabaseUser();
    return jsonWithSession(
      {
        configured: hasSupabaseServerConfig(),
        user: user
          ? {
              id: user.id,
              email: getSupabaseUserPublicEmail(user),
              accountName: getSupabaseUserAccountName(user),
            }
          : null,
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
