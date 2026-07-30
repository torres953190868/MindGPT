import type { NextRequest } from "next/server";
import { requireAdminAccess } from "@/lib/server/admin-auth";
import { ADMIN_USERS_PAGE_SIZE, listAdminUsers } from "@/lib/server/admin-users";
import { HttpError, jsonWithSession, safeErrorWithSession } from "@/lib/server/http";
import { getOrCreateSession } from "@/lib/server/session";

export async function GET(request: NextRequest) {
  const session = getOrCreateSession(request);

  try {
    await requireAdminAccess(request);

    const pageParam = request.nextUrl.searchParams.get("page");
    const page = pageParam ? Number(pageParam) : 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new HttpError("Invalid user list page.", {
        code: "ADMIN_USERS_PAGE_INVALID",
        expose: true,
        status: 400,
      });
    }

    const result = await listAdminUsers({
      page,
      perPage: ADMIN_USERS_PAGE_SIZE,
      query: request.nextUrl.searchParams.get("query") ?? "",
    });

    return jsonWithSession(result, session);
  } catch (error) {
    return safeErrorWithSession(error, session);
  }
}
