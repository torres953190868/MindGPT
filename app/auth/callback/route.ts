import { NextResponse, type NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { tryMigrateAnonymousDataToUser } from "@/lib/server/account-migration";
import { getExistingSessionId } from "@/lib/server/session";
import { createSupabaseCookieClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeAuthNext(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(next, requestUrl.origin);
  const anonymousSessionId = getExistingSessionId(request);

  if (code) {
    const supabase = await createSupabaseCookieClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      redirectUrl.searchParams.set("auth", "failed");
    } else if (data?.user) {
      const migration = await tryMigrateAnonymousDataToUser(
        anonymousSessionId,
        data.user.id,
      );
      if (!migration.ok) redirectUrl.searchParams.set("migration", "failed");
    }
  }

  return NextResponse.redirect(redirectUrl);
}
