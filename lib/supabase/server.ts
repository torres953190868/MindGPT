import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

export type SupabaseServerConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

let adminClient: SupabaseClient<Database> | null = null;

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getSupabasePublicKey() {
  return (
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  );
}

export function getSupabaseServerConfig(): SupabaseServerConfig | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = getSupabasePublicKey();
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export function hasSupabaseServerConfig() {
  return Boolean(getSupabaseServerConfig());
}

export function requireSupabaseServerConfig(): SupabaseServerConfig {
  const config = getSupabaseServerConfig();
  if (config) return config;

  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      getSupabasePublicKey(),
    ],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !clean(value))
    .map(([name]) => name);

  throw new Error(
    `Supabase server configuration is required. Missing: ${missing.join(", ")}.`,
  );
}

export function createSupabaseAdminClient(config = requireSupabaseServerConfig()) {
  return createClient<Database>(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "branchmind-server",
      },
    },
  });
}

export function getSupabaseAdminClient() {
  adminClient ??= createSupabaseAdminClient();
  return adminClient;
}

export async function createSupabaseCookieClient(config = requireSupabaseServerConfig()) {
  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. Route handlers can.
        }
      },
    },
  });
}
