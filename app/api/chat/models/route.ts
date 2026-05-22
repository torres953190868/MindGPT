import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getLlmChatModelCatalog } from "@/lib/server/llm-router";
import { getExistingSessionId, getOrCreateSession } from "@/lib/server/session";
import { hasSupabaseServerConfig } from "@/lib/supabase/server";

const READ_ONLY_LOCAL_SESSION = { id: "", isNew: false };

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    if (!hasSupabaseServerConfig() && !getExistingSessionId(request)) {
      return jsonWithSession(await getLlmChatModelCatalog(), READ_ONLY_LOCAL_SESSION);
    }

    const { session } = await getBranchMindAuthContext(request);
    return jsonWithSession(await getLlmChatModelCatalog(), session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
