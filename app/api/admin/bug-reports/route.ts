import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { listAdminBugReports } from "@/lib/server/bug-reports";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";
import type { BugReportStatus } from "@/lib/types";

const STATUSES = new Set(["open", "triaged", "fixed", "closed", "all"]);

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);
    const status = request.nextUrl.searchParams.get("status") ?? "open";
    if (!STATUSES.has(status)) {
      throw new HttpError("Invalid bug report status filter.", {
        code: "BUG_REPORT_STATUS_INVALID",
        expose: true,
        status: 400,
      });
    }

    return jsonWithSession(
      {
        reports: await listAdminBugReports(status as BugReportStatus | "all"),
      },
      session,
    );
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
