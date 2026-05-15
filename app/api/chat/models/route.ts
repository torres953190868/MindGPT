import type { NextRequest } from "next/server";
import { getBranchMindAuthContext } from "@/lib/server/auth";
import { getChatModelCatalog } from "@/lib/server/deepseek-core";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";

export async function GET(request: NextRequest) {
  const fallbackSession = getOrCreateSession(request);

  try {
    const { session } = await getBranchMindAuthContext(request);
    return jsonWithSession(getChatModelCatalog(), session);
  } catch (error) {
    return safeErrorWithSession(error, fallbackSession);
  }
}
