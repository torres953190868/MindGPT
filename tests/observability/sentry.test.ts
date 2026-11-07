import { describe, expect, it } from "vitest";
import {
  getSentryDsn,
  getSentryEnvironment,
  getSentryInitOptions,
  getSentryTracesSampleRate,
  isSentryConfiguredForBuild,
  isSentrySourceMapUploadEnabled,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentrySpan,
  scrubSentryText,
  SENTRY_REDACTED,
  shouldCaptureBoundaryError,
  stripUrlQuery,
} from "@/lib/observability/sentry";

const DSN = "https://public@o0.ingest.sentry.io/0";

describe("Sentry config helpers", () => {
  it("is disabled when no DSN is configured", () => {
    expect(getSentryInitOptions("client", {})).toBeNull();
    expect(getSentryInitOptions("server", {})).toBeNull();
    expect(getSentryInitOptions("edge", { SENTRY_DSN: "   " })).toBeNull();
    expect(isSentryConfiguredForBuild({ NODE_ENV: "production" })).toBe(false);
  });

  it("reads only the public DSN in the browser and falls back to it on the server", () => {
    expect(getSentryDsn("client", { SENTRY_DSN: DSN })).toBeUndefined();
    expect(getSentryDsn("client", { NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(DSN);
    expect(getSentryDsn("server", { NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(DSN);
    expect(
      getSentryDsn("edge", { SENTRY_DSN: "https://server@o0.ingest.sentry.io/1", NEXT_PUBLIC_SENTRY_DSN: DSN }),
    ).toBe("https://server@o0.ingest.sentry.io/1");
    expect(isSentryConfiguredForBuild({ SENTRY_DSN: DSN })).toBe(true);
  });

  it("derives the environment from VERCEL_ENV, then NODE_ENV", () => {
    expect(getSentryEnvironment("server", { VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("preview");
    expect(getSentryEnvironment("server", { NODE_ENV: "production" })).toBe("production");
    expect(getSentryEnvironment("client", { VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("production");
    expect(getSentryEnvironment("client", { NEXT_PUBLIC_VERCEL_ENV: "preview" })).toBe("preview");
    expect(getSentryEnvironment("edge", {})).toBe("development");
  });

  it("samples traces at 0.1 in production and 0 elsewhere unless overridden", () => {
    expect(getSentryTracesSampleRate("server", {}, "production")).toBe(0.1);
    expect(getSentryTracesSampleRate("server", {}, "preview")).toBe(0);
    expect(getSentryTracesSampleRate("server", { SENTRY_TRACES_SAMPLE_RATE: "0.25" }, "development")).toBe(0.25);
    expect(getSentryTracesSampleRate("server", { SENTRY_TRACES_SAMPLE_RATE: "5" }, "production")).toBe(1);
    expect(getSentryTracesSampleRate("server", { SENTRY_TRACES_SAMPLE_RATE: "-1" }, "production")).toBe(0);
    expect(getSentryTracesSampleRate("server", { SENTRY_TRACES_SAMPLE_RATE: "abc" }, "production")).toBe(0.1);
    expect(getSentryTracesSampleRate("client", { SENTRY_TRACES_SAMPLE_RATE: "1" }, "production")).toBe(0.1);
    expect(
      getSentryTracesSampleRate("client", { NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.5" }, "production"),
    ).toBe(0.5);
  });

  it("uploads source maps only when token, org, and project are all set", () => {
    expect(isSentrySourceMapUploadEnabled({})).toBe(false);
    expect(isSentrySourceMapUploadEnabled({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o" })).toBe(false);
    expect(
      isSentrySourceMapUploadEnabled({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" }),
    ).toBe(true);
  });

  it("builds locked-down init options when a DSN is configured", () => {
    const options = getSentryInitOptions("server", { SENTRY_DSN: DSN, VERCEL_ENV: "production" });

    expect(options).toMatchObject({
      dsn: DSN,
      environment: "production",
      tracesSampleRate: 0.1,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
      beforeSendSpan: scrubSentrySpan,
    });
    expect(options?.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    });
  });

  it("only reports client-originated boundary errors", () => {
    expect(shouldCaptureBoundaryError({})).toBe(true);
    expect(shouldCaptureBoundaryError({ digest: "123" })).toBe(false);
  });
});

describe("Sentry scrubbers", () => {
  it("strips query strings and fragments from URLs", () => {
    expect(stripUrlQuery("https://branchmind.cn/auth/callback?code=secret#x")).toBe(
      "https://branchmind.cn/auth/callback",
    );
    expect(stripUrlQuery("/workspace/p1#node")).toBe("/workspace/p1");
    expect(stripUrlQuery("/api/projects")).toBe("/api/projects");
  });

  it("removes request data, cookies, headers, and user fields other than id", () => {
    const event = scrubSentryEvent({
      message: "boom",
      request: {
        url: "https://branchmind.cn/api/projects/p1/nodes/stream?token=abc",
        method: "POST",
        data: { instruction: "my private question" },
        query_string: "token=abc",
        cookies: { branchmind_session: "secret" },
        headers: { authorization: "Bearer secret", cookie: "branchmind_session=secret" },
        env: { REMOTE_ADDR: "1.2.3.4" },
      },
      user: { id: "user_1", email: "a@example.com", username: "alice", ip_address: "1.2.3.4" },
    });

    expect(event).toEqual({
      message: "boom",
      request: {
        url: "https://branchmind.cn/api/projects/p1/nodes/stream",
        method: "POST",
      },
      user: { id: "user_1" },
    });
  });

  it("drops console and UI breadcrumbs and reduces network breadcrumbs", () => {
    expect(scrubSentryBreadcrumb({ category: "console", message: "chat content" })).toBeNull();
    expect(scrubSentryBreadcrumb({ category: "ui.click", message: "div[title=\"Secret node\"]" })).toBeNull();
    expect(
      scrubSentryBreadcrumb({
        category: "fetch",
        data: {
          method: "POST",
          status_code: 500,
          url: "/api/documents/d1/query?q=private",
          request_body_size: 1234,
          request_body: "private",
        },
      }),
    ).toEqual({
      category: "fetch",
      data: { method: "POST", status_code: 500, url: "/api/documents/d1/query" },
    });
    expect(
      scrubSentryBreadcrumb({
        category: "navigation",
        data: { from: "/?code=oauth", to: "/workspace/p1?tab=notes" },
      }),
    ).toEqual({ category: "navigation", data: { from: "/", to: "/workspace/p1" } });
  });

  it("scrubs breadcrumbs attached to events", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        { category: "console", message: "leak" },
        { category: "navigation", data: { to: "/reader?doc=1" } },
      ],
    });

    expect(event.breadcrumbs).toEqual([{ category: "navigation", data: { to: "/reader" } }]);
  });

  it("removes sensitive span attributes and query strings", () => {
    const span = scrubSentrySpan({
      name: "POST /api/chat",
      attributes: {
        "http.request.method": "POST",
        "http.request.header.cookie": "secret",
        "http.response.header.set-cookie": "secret",
        "http.request.body": "{\"message\":\"private\"}",
        "url.query": "?token=abc",
        "gen_ai.input.messages": "[private]",
        "url.full": "https://api.deepseek.com/chat/completions?key=abc",
      },
    });

    expect(span.attributes).toEqual({
      "http.request.method": "POST",
      "url.full": "https://api.deepseek.com/chat/completions",
    });
  });
});

describe("Sentry free-text scrubbing", () => {
  const MARKER = "PRIVATE_MARKER_7f3a";

  it("keeps short structural messages intact", () => {
    expect(scrubSentryText("db down")).toBe("db down");
    expect(scrubSentryText("Unexpected token '<' at position 0")).toBe("Unexpected token '<' at position 0");
    expect(scrubSentryText("Can't reach provider: timeout")).toBe("Can't reach provider: timeout");
    expect(scrubSentryText("Object captured as exception with keys: prompt")).toBe(
      "Object captured as exception with keys: prompt",
    );
  });

  it("redacts quoted segments, embedded JSON, extra lines, and long payloads", () => {
    expect(scrubSentryText(`Unexpected token 'M', "${MARKER} my notes" is not valid JSON`)).toBe(
      `Unexpected token 'M', "[redacted]" is not valid JSON`,
    );
    expect(scrubSentryText(`Unterminated string "${MARKER} cut off`)).toBe(`Unterminated string "[redacted]"`);
    expect(scrubSentryText(`Bad field '${MARKER}'`)).toBe("Bad field '[redacted]'");
    expect(scrubSentryText(`Gemini request failed (400): {"error":{"message":"${MARKER}"}}`)).toBe(
      "Gemini request failed (400): [redacted]",
    );
    expect(scrubSentryText(`Invalid items [${MARKER}]`)).toBe("Invalid items [redacted]");
    expect(scrubSentryText(`Model output was invalid:\n${MARKER}`)).toBe("Model output was invalid: [redacted]");
    expect(scrubSentryText(`Failed to parse model output: ${MARKER} ${"lorem ipsum ".repeat(10)}`)).toBe(
      "Failed to parse model output: [redacted]",
    );
    expect(scrubSentryText(`${MARKER} ${"x".repeat(250)}`)).toBe(SENTRY_REDACTED);
  });

  it("scrubs exception values, messages, and logentry while keeping type, stack, and tags", () => {
    const frames = [{ filename: "app:///lib/server/ai.js", function: "callProvider", lineno: 10 }];
    const event = scrubSentryEvent({
      message: `Model output was invalid:\n${MARKER}`,
      logentry: { message: `Prompt was "${MARKER}"`, params: [MARKER] },
      exception: {
        values: [
          {
            type: "SyntaxError",
            value: `Unexpected token 'h', "${MARKER}" is not valid JSON`,
            stacktrace: { frames },
            mechanism: { type: "generic", handled: true },
          },
        ],
      },
      tags: { request_id: "req_123", status_code: "500", error_code: "INVALID_JSON", action: "stream-node" },
    });

    expect(JSON.stringify(event)).not.toContain(MARKER);
    expect(event.message).toBe("Model output was invalid: [redacted]");
    expect(event.logentry).toEqual({ message: 'Prompt was "[redacted]"' });
    expect(event.exception.values[0]).toEqual({
      type: "SyntaxError",
      value: `Unexpected token 'h', "[redacted]" is not valid JSON`,
      stacktrace: { frames },
      mechanism: { type: "generic", handled: true },
    });
    expect(event.tags).toEqual({
      request_id: "req_123",
      status_code: "500",
      error_code: "INVALID_JSON",
      action: "stream-node",
    });
  });

  it("drops extra (including __serialized__) and non-SDK contexts", () => {
    const event = scrubSentryEvent({
      extra: { __serialized__: { prompt: MARKER }, instruction: MARKER },
      contexts: {
        conversation: { content: MARKER },
        runtime: { name: "node", version: "v24" },
        trace: {
          trace_id: "t1",
          span_id: "s1",
          data: { "http.request.body": MARKER, "url.full": "https://api.example.com/x?q=secret" },
        },
        response: { status_code: 500, headers: { "set-cookie": MARKER } },
        nextjs: { request_path: "/workspace/p1?token=secret", router_kind: "App Router" },
      },
    });

    expect(JSON.stringify(event)).not.toContain(MARKER);
    expect(event).not.toHaveProperty("extra");
    expect(event.contexts).toEqual({
      runtime: { name: "node", version: "v24" },
      trace: { trace_id: "t1", span_id: "s1", data: { "url.full": "https://api.example.com/x" } },
      response: { status_code: 500 },
      nextjs: { request_path: "/workspace/p1", router_kind: "App Router" },
    });
  });

  it("scrubs breadcrumb messages that repeat earlier errors", () => {
    expect(
      scrubSentryBreadcrumb({ category: "sentry.event", message: `Error: Upstream said "${MARKER}"` }),
    ).toEqual({ category: "sentry.event", message: 'Error: Upstream said "[redacted]"' });
  });
});
