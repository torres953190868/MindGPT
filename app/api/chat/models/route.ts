import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getChatModelCatalog } from "@/lib/server/deepseek-core";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession(getChatModelCatalog(), READ_ONLY_LOCAL_SESSION);
    }

    const { session } = await getBranchMindAuthContext(request);
    return jsonWithSession(getChatModelCatalog(), session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
