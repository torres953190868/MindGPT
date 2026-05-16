import type { NextRequest } from "next/server";
import { HttpError } from "@/lib/server/http";
import { getOrCreateSession, type BranchMindSession } from "@/lib/server/session";
import {
  createSupabaseCookieClient,
  hasSupabaseServerConfig,
} from "@/lib/supabase/server";

export type BranchMindPrincipal = {
  id: string;
  email: string | null;
  authMode: "supabase" | "local";
};

export type BranchMindAuthContext = {
  principal: BranchMindPrincipal;
  session: BranchMindSession;
};

type SupabaseUserEmailState = {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

export function isSupabaseUserEmailConfirmed(user: SupabaseUserEmailState) {
  if (!user.email) return true;
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

export async function getOptionalSupabaseUser() {
  if (!hasSupabaseServerConfig()) return null;

  const supabase = await createSupabaseCookieClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isSupabaseUserEmailConfirmed(data.user)) return null;

  return data.user;
}

export async function getBranchMindAuthContext(
  request: NextRequest,
): Promise<BranchMindAuthContext> {
  if (hasSupabaseServerConfig()) {
    const user = await getOptionalSupabaseUser();
    if (!user) {
      throw new HttpError("Sign in is required.", {
        code: "AUTH_REQUIRED",
        expose: true,
        status: 401,
      });
    }

    return {
      principal: {
        id: user.id,
        email: user.email ?? null,
        authMode: "supabase",
      },
      session: { id: user.id, isNew: false },
    };
  }

  const session = getOrCreateSession(request);
  return {
    principal: {
      id: session.id,
      email: null,
      authMode: "local",
    },
    session,
  };
}
