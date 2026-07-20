import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitStorage = "map" | "supabase";

type SupabaseRateLimitRow = {
  count?: number | string | null;
  reset_at?: string | null;
};

export type RateLimitOptions = {
  action: string;
  sessionId: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  storage?: RateLimitStorage;
};

const buckets = new Map<string, RateLimitEntry>();
let supabaseClient: SupabaseClient | null | undefined;
let hasWarnedAboutMapFallback = false;

function getFallbackErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}

function warnAboutMapFallback(reason: string, error?: unknown) {
  if (hasWarnedAboutMapFallback) return;
  hasWarnedAboutMapFallback = true;

  console.warn(
    "BranchMind rate limiting fell back to in-memory storage; limits are per-instance only.",
    {
      reason,
      error: getFallbackErrorMessage(error),
    },
  );
}

function getClientFingerprint(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.slice(0, 80) ?? "unknown";

  return `${forwardedFor || realIp || "local"}:${userAgent}`;
}

function pruneExpired(now: number) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

function buildRateLimitKey(request: NextRequest, options: RateLimitOptions) {
  return [
    options.action,
    options.sessionId,
    getClientFingerprint(request),
  ].join(":");
}

function checkMapRateLimit(
  key: string,
  now: number,
  options: RateLimitOptions,
): RateLimitResult {
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0, storage: "map" };
  }

  if (current.count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      storage: "map",
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0, storage: "map" };
}

function getSupabaseClient() {
  if (supabaseClient !== undefined) return supabaseClient;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  supabaseClient = url && key
    ? createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

  return supabaseClient;
}

function getRateLimitTableName() {
  return process.env.RATE_LIMIT_TABLE ?? "rate_limits";
}

function normalizeSupabaseRow(data: unknown): SupabaseRateLimitRow | null {
  return data && typeof data === "object"
    ? (data as SupabaseRateLimitRow)
    : null;
}

function getRowResetAt(row: SupabaseRateLimitRow) {
  const resetAt = row.reset_at ? Date.parse(row.reset_at) : Number.NaN;
  return Number.isFinite(resetAt) ? resetAt : null;
}

function getRowCount(row: SupabaseRateLimitRow) {
  const count = Number(row.count ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function hashRateLimitKey(key: string) {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") return key;

  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function checkSupabaseRateLimit(
  key: string,
  request: NextRequest,
  now: number,
  options: RateLimitOptions,
): Promise<RateLimitResult | null> {
  const client = getSupabaseClient();
  if (!client) {
    warnAboutMapFallback("supabase-client-unavailable");
    return null;
  }

  const table = getRateLimitTableName();
  const hashedKey = await hashRateLimitKey(key);
  const fingerprint = getClientFingerprint(request);
  const updatedAt = new Date(now).toISOString();

  const { data, error } = await client
    .from(table)
    .select("count, reset_at")
    .eq("key", hashedKey)
    .maybeSingle();

  if (error) {
    warnAboutMapFallback("supabase-read-failed", error);
    return null;
  }

  const row = normalizeSupabaseRow(data);
  const resetAt = row ? getRowResetAt(row) : null;

  if (!row || resetAt === null || resetAt <= now) {
    const nextResetAt = now + options.windowMs;
    const { error: upsertError } = await client.from(table).upsert(
      {
        key: hashedKey,
        action: options.action,
        session_id: options.sessionId,
        fingerprint,
        count: 1,
        reset_at: new Date(nextResetAt).toISOString(),
        updated_at: updatedAt,
      },
      { onConflict: "key" },
    );

    if (upsertError) {
      warnAboutMapFallback("supabase-write-failed", upsertError);
      return null;
    }
    return { allowed: true, retryAfterSeconds: 0, storage: "supabase" };
  }

  const count = getRowCount(row);
  if (count >= options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      storage: "supabase",
    };
  }

  const { error: updateError } = await client
    .from(table)
    .update({ count: count + 1, updated_at: updatedAt })
    .eq("key", hashedKey);

  if (updateError) {
    warnAboutMapFallback("supabase-write-failed", updateError);
    return null;
  }
  return { allowed: true, retryAfterSeconds: 0, storage: "supabase" };
}

export function checkRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  return checkMapRateLimit(buildRateLimitKey(request, options), now, options);
}

export async function checkRateLimitAsync(
  request: NextRequest,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now();
  pruneExpired(now);

  const key = buildRateLimitKey(request, options);
  const supabaseResult = await checkSupabaseRateLimit(key, request, now, options);
  return supabaseResult ?? checkMapRateLimit(key, now, options);
}
