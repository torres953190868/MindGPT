import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import {
  adminBugReportUpdateSchema,
  updateAdminBugReport,
} from "@/lib/server/bug-reports";
import { jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import { parseJsonBody } from "@/lib/server/validation";

type BugReportRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: BugReportRouteContext) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    const { id } = await context.params;
    const body = await parseJsonBody(request, adminBugReportUpdateSchema, {
      maxBytes: 16 * 1024,
    });

    return jsonWithSession(
      { report: await updateAdminBugReport(id, body) },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
