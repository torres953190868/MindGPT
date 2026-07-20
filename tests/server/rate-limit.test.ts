import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, checkRateLimitAsync } from "@/lib/server/rate-limit";

function request(headers: Record<string, string> = {}) {
  return {
    headers: new Headers({
      "user-agent": "vitest",
      ...headers,
    }),
  } as unknown as NextRequest;
}

describe("rate-limit helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("blocks requests after the configured limit until the window resets", () => {
    const options = {
      action: "unit-rate-limit-window",
      sessionId: "session-a",
      limit: 2,
      windowMs: 1_000,
    };

    expect(checkRateLimit(request(), options)).toMatchObject({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(request(), options)).toMatchObject({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(request(), options)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });

    vi.advanceTimersByTime(1_001);
    expect(checkRateLimit(request(), options)).toMatchObject({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("keeps separate buckets for sessions and client fingerprints", () => {
    const baseOptions = {
      action: "unit-rate-limit-buckets",
      limit: 1,
      windowMs: 60_000,
    };

    expect(
      checkRateLimit(request({ "x-forwarded-for": "10.0.0.1" }), {
        ...baseOptions,
        sessionId: "session-a",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      checkRateLimit(request({ "x-forwarded-for": "10.0.0.1" }), {
        ...baseOptions,
        sessionId: "session-a",
      }),
    ).toMatchObject({ allowed: false });
    expect(
      checkRateLimit(request({ "x-forwarded-for": "10.0.0.2" }), {
        ...baseOptions,
        sessionId: "session-a",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      checkRateLimit(request({ "x-forwarded-for": "10.0.0.1" }), {
        ...baseOptions,
        sessionId: "session-b",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("warns once when Supabase is unavailable and limits fall back to the map", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = {
      action: "unit-rate-limit-fallback",
      sessionId: "session-a",
      limit: 1,
      windowMs: 60_000,
    };

    const first = await checkRateLimitAsync(request(), options);
    const second = await checkRateLimitAsync(request(), options);

    expect(first).toMatchObject({ allowed: true, storage: "map" });
    expect(second).toMatchObject({ allowed: false, storage: "map" });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("in-memory"),
      expect.objectContaining({ reason: "supabase-client-unavailable" }),
    );
  });
});
