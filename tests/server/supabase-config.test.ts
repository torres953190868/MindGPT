import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseServerConfig } from "@/lib/supabase/server";

const supabaseEnvKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const originalEnv = Object.fromEntries(
  supabaseEnvKeys.map((key) => [key, process.env[key]]),
);

function clearSupabaseEnv() {
  for (const key of supabaseEnvKeys) delete process.env[key];
}

describe("Supabase server config", () => {
  afterEach(() => {
    clearSupabaseEnv();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) continue;
      process.env[key] = value;
    }
  });

  it("accepts Supabase publishable key as the public auth key", () => {
    clearSupabaseEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.branchmind.example";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable_test_key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test_key";

    expect(getSupabaseServerConfig()).toEqual({
      url: "https://supabase.branchmind.example",
      anonKey: "publishable_test_key",
      serviceRoleKey: "service_role_test_key",
    });
  });
});
