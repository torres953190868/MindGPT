import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import {
  adminLlmConfigActionSchema,
  applyAdminLlmConfigAction,
} from "@/lib/server/admin-llm-config";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getAdminLlmConfig } from "@/lib/server/llm-router";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    return jsonWithSession(await getAdminLlmConfig(), session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}

export async function POST(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    const body = await parseJsonBody(request, adminLlmConfigActionSchema, {
      maxBytes: 64 * 1024,
    });
    return jsonWithSession(await applyAdminLlmConfigAction(body), session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
