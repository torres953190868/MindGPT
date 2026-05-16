import { NextResponse, type NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { createSupabaseCookieClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeAuthNext(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(next, requestUrl.origin);

  if (code) {
    const supabase = await createSupabaseCookieClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      redirectUrl.searchParams.set("auth", "failed");
    }
  }

  return NextResponse.redirect(redirectUrl);
}
