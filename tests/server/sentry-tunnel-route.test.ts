import { afterEach, describe, expect, it, vi } from "vitest";

const DSN = "https://public@o0.ingest.sentry.io/0";

async function loadRoute() {
  vi.resetModules();
  return import("@/app/sentry-tunnel/route");
}

function envelopeRequest(dsn: string) {
  const body = `${JSON.stringify({ dsn, sent_at: new Date().toISOString() })}\n{"type":"event"}\n{}`;
  return new Request("http://127.0.0.1/sentry-tunnel", {
    method: "POST",
    headers: { "content-length": String(new TextEncoder().encode(body).byteLength) },
    body,
  });
}

describe("Sentry tunnel route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when Sentry is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { POST } = await loadRoute();

    const response = await POST(envelopeRequest(DSN));

    expect(response.status).toBe(404);
  });

  it("rejects envelopes for DSNs other than the browser DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { POST } = await loadRoute();

    const response = await POST(envelopeRequest("https://attacker@o1.ingest.sentry.io/2"));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
