import { NextResponse, type NextRequest } from "next/server";
import { sanitizeAuthNext } from "@/lib/server/auth-redirect";
import { createSupabaseCookieClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = sanitizeAuthNext(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseCookieClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
