"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getSupabaseBrowserConfig(): SupabaseBrowserConfig | null {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function createSupabaseBrowserClient() {
  const config = getSupabaseBrowserConfig();

  if (!config) {
    throw new Error(
      "Supabase browser configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createBrowserClient<Database>(config.url, config.anonKey);
}
