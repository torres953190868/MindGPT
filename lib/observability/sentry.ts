// Pure, SDK-free Sentry configuration helpers shared by
// `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`,
// `next.config.ts`, and the tunnel route. Sentry is fully opt-in: without a DSN
// `getSentryInitOptions()` returns null and the SDK is never initialized.
//
// Privacy: BranchMind stores users' AI conversations and PDFs, so every option
// below defaults to collecting as little as possible. `@sentry/nextjs` v11
// replaced `sendDefaultPii` with the granular `dataCollection` option, which is
// locked down here; `beforeSend` / `beforeBreadcrumb` / `beforeSendSpan` scrub
// anything that slips through (request bodies, cookies, headers, query strings,
// user fields other than the internal id, free text in exception/event messages,
// `extra`, and non-SDK contexts).

export type SentryRuntime = "client" | "server" | "edge";

export type SentryEnv = Readonly<Record<string, string | undefined>>;

/** Same-origin path the browser SDK posts envelopes to (see `next.config.ts`). */
export const SENTRY_TUNNEL_ROUTE = "/monitoring";

const PRODUCTION_TRACES_SAMPLE_RATE = 0.1;

function readEnv(env: SentryEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * Browser code can only read `NEXT_PUBLIC_*` values, so the client DSN is the
 * public one. Server and edge prefer `SENTRY_DSN` and fall back to the public DSN.
 */
export function getSentryDsn(runtime: SentryRuntime, env: SentryEnv): string | undefined {
  if (runtime === "client") return readEnv(env, "NEXT_PUBLIC_SENTRY_DSN");
  return readEnv(env, "SENTRY_DSN") ?? readEnv(env, "NEXT_PUBLIC_SENTRY_DSN");
}

/** True when any runtime has a DSN, i.e. the build should be wrapped with `withSentryConfig`. */
export function isSentryConfiguredForBuild(env: SentryEnv): boolean {
  return Boolean(getSentryDsn("server", env));
}

/** Source maps are uploaded only when all three Sentry CLI credentials are present. */
export function isSentrySourceMapUploadEnabled(env: SentryEnv): boolean {
  return Boolean(
    readEnv(env, "SENTRY_AUTH_TOKEN") &&
      readEnv(env, "SENTRY_ORG") &&
      readEnv(env, "SENTRY_PROJECT"),
  );
}

export function getSentryEnvironment(runtime: SentryRuntime, env: SentryEnv): string {
  const vercelEnv =
    runtime === "client"
      ? readEnv(env, "NEXT_PUBLIC_VERCEL_ENV")
      : readEnv(env, "VERCEL_ENV") ?? readEnv(env, "NEXT_PUBLIC_VERCEL_ENV");

  return vercelEnv ?? readEnv(env, "NODE_ENV") ?? "development";
}

export function getSentryTracesSampleRate(
  runtime: SentryRuntime,
  env: SentryEnv,
  environment: string,
): number {
  const fallback = environment === "production" ? PRODUCTION_TRACES_SAMPLE_RATE : 0;
  const raw =
    runtime === "client"
      ? readEnv(env, "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE")
      : readEnv(env, "SENTRY_TRACES_SAMPLE_RATE") ??
        readEnv(env, "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE");

  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(1, Math.max(0, parsed));
}

/** Strips query string and fragment, which may carry OAuth codes or other secrets. */
export function stripUrlQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

type ScrubbableRequest = {
  url?: string;
  data?: unknown;
  query_string?: unknown;
  cookies?: unknown;
  headers?: unknown;
  env?: unknown;
};

type ScrubbableUser = {
  id?: string | number;
};

type ScrubbableBreadcrumb = {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
};

type ScrubbableException = {
  type?: string;
  value?: string;
};

type ScrubbableEvent = {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: { values?: ScrubbableException[] };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  request?: ScrubbableRequest;
  user?: ScrubbableUser;
  breadcrumbs?: ScrubbableBreadcrumb[];
};

type ScrubbableSpan = {
  attributes?: Record<string, unknown>;
};

/** Fixed placeholder for free text removed from events. */
export const SENTRY_REDACTED = "[redacted]";

const MAX_EVENT_TEXT_LENGTH = 200;
const MAX_TEXT_AFTER_COLON_LENGTH = 80;
const MAX_KEPT_QUOTED_LENGTH = 3;
const QUOTE_PAIRS: Readonly<Record<string, string>> = { '"': '"', "“": "”", "`": "`", "'": "'" };
// Double, curly, and backtick quotes run to their closing quote or to the end of
// the text (truncated echoes). Single quotes count only when not preceded by a
// letter or digit, so English contractions ("can't") are left alone. No
// lookbehind: older Safari versions fail to parse it.
const QUOTED_SEGMENT = /"[^"]*"?|“[^”]*”?|`[^`]*`?|(^|[^\p{L}\p{N}])('[^'\n]*')/gu;
// An opening brace/bracket that is not one of our own placeholders.
const EMBEDDED_PAYLOAD = /[{[](?!redacted\])[\s\S]*$/;
const COLON_SEPARATOR = /:\s/g;

function redactQuotedSegment(segment: string): string {
  const open = segment[0];
  const close = QUOTE_PAIRS[open] ?? open;
  const terminated = segment.length > 1 && segment.endsWith(close);
  const inner = segment.slice(1, terminated ? -1 : undefined);

  // Keep short quoted tokens (`Unexpected token '<'`), which help debugging and
  // cannot carry meaningful content.
  if (terminated && inner.length <= MAX_KEPT_QUOTED_LENGTH) return segment;
  return `${open}${SENTRY_REDACTED}${close}`;
}

/**
 * Scrubs free text that ends up in Sentry (exception messages, captured
 * messages, breadcrumb messages). Parse errors and upstream LLM/provider errors
 * often echo conversation or PDF text, so the policy keeps only the structural
 * prefix of a message:
 *
 * 1. Only the first line is kept; anything after a line break is redacted.
 * 2. Quoted segments ("…", “…”, `…`, '…') are replaced with `[redacted]`,
 *    except tokens of up to 3 characters such as `'<'`.
 * 3. Everything from the first `{` or `[` on (embedded JSON/array bodies) is
 *    replaced with `[redacted]`.
 * 4. Text after a `: ` separator that is longer than 80 characters is replaced
 *    with `[redacted]`.
 * 5. A result still longer than 200 characters is replaced entirely.
 *
 * The exception type, stack frames, and tags are never touched, so events stay
 * groupable and debuggable.
 */
export function scrubSentryText(text: string): string {
  const lineBreak = text.search(/[\r\n]/);
  let scrubbed = lineBreak === -1 ? text : `${text.slice(0, lineBreak)} ${SENTRY_REDACTED}`;

  scrubbed = scrubbed.replace(QUOTED_SEGMENT, (match: string, prefix?: string, singleQuoted?: string) =>
    singleQuoted === undefined
      ? redactQuotedSegment(match)
      : `${prefix ?? ""}${redactQuotedSegment(singleQuoted)}`,
  );
  scrubbed = scrubbed.replace(EMBEDDED_PAYLOAD, SENTRY_REDACTED);

  for (const separator of scrubbed.matchAll(COLON_SEPARATOR)) {
    const restStart = separator.index + separator[0].length;
    if (scrubbed.length - restStart > MAX_TEXT_AFTER_COLON_LENGTH) {
      scrubbed = `${scrubbed.slice(0, restStart)}${SENTRY_REDACTED}`;
      break;
    }
  }

  return scrubbed.length > MAX_EVENT_TEXT_LENGTH ? SENTRY_REDACTED : scrubbed;
}

// Contexts the SDKs populate with runtime/environment metadata. Anything else
// (e.g. a future `setContext("conversation", …)`) is dropped.
const ALLOWED_EVENT_CONTEXTS = new Set([
  "app",
  "browser",
  "cloud_resource",
  "culture",
  "device",
  "flags",
  "nextjs",
  "os",
  "otel",
  "react",
  "response",
  "runtime",
  "trace",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scrubEventContexts(contexts: Record<string, unknown>) {
  for (const key of Object.keys(contexts)) {
    if (!ALLOWED_EVENT_CONTEXTS.has(key)) delete contexts[key];
  }

  // Span attributes copied into the trace context get the same treatment as spans.
  const trace = contexts.trace;
  if (isRecord(trace) && isRecord(trace.data)) scrubSentrySpan({ attributes: trace.data });

  // The response context may carry headers; keep only the status code.
  const response = contexts.response;
  if (isRecord(response)) {
    contexts.response =
      response.status_code === undefined ? {} : { status_code: response.status_code };
  }

  const nextjs = contexts.nextjs;
  if (isRecord(nextjs) && typeof nextjs.request_path === "string") {
    nextjs.request_path = stripUrlQuery(nextjs.request_path);
  }
}

const NETWORK_BREADCRUMB_CATEGORIES = new Set(["fetch", "xhr", "http"]);
const NETWORK_BREADCRUMB_DATA_KEYS = new Set(["method", "status_code", "url"]);

/**
 * `beforeBreadcrumb` hook. Drops console breadcrumbs (logs may echo chat or PDF
 * text) and UI breadcrumbs (element selectors can include node titles), reduces
 * network/navigation breadcrumbs to method, status, and query-free URLs, and
 * scrubs breadcrumb messages (`sentry.event` breadcrumbs repeat error messages).
 */
export function scrubSentryBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T | null {
  const category = breadcrumb.category ?? "";
  if (category === "console" || category.startsWith("ui.")) return null;

  if (typeof breadcrumb.message === "string") breadcrumb.message = scrubSentryText(breadcrumb.message);

  const data = breadcrumb.data;
  if (!data) return breadcrumb;

  if (NETWORK_BREADCRUMB_CATEGORIES.has(category)) {
    for (const key of Object.keys(data)) {
      if (!NETWORK_BREADCRUMB_DATA_KEYS.has(key)) delete data[key];
    }
  }

  for (const key of ["url", "from", "to"]) {
    const value = data[key];
    if (typeof value === "string") data[key] = stripUrlQuery(value);
  }

  return breadcrumb;
}

/**
 * `beforeSend` hook. Scrubs free text (exception values, `message`, `logentry`)
 * with `scrubSentryText`, drops `extra` (the SDK serializes captured non-Error
 * objects into `extra.__serialized__`) and non-SDK contexts, removes request
 * bodies, cookies, headers, query strings, and environment data, keeps only the
 * internal user id, and re-scrubs breadcrumbs recorded before the hooks ran.
 * Exception types, stack frames, and tags are left intact.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = scrubSentryText(exception.value);
  }

  if (typeof event.message === "string") event.message = scrubSentryText(event.message);

  const logentry = event.logentry;
  if (logentry) {
    if (typeof logentry.message === "string") logentry.message = scrubSentryText(logentry.message);
    delete logentry.params;
  }

  delete event.extra;

  if (event.contexts) scrubEventContexts(event.contexts);

  const request = event.request;
  if (request) {
    delete request.data;
    delete request.query_string;
    delete request.cookies;
    delete request.headers;
    delete request.env;
    if (typeof request.url === "string") request.url = stripUrlQuery(request.url);
  }

  const user = event.user;
  if (user) {
    for (const key of Object.keys(user)) {
      if (key !== "id") delete (user as Record<string, unknown>)[key];
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => {
      const scrubbed = scrubSentryBreadcrumb(breadcrumb);
      return scrubbed ? [scrubbed] : [];
    });
  }

  return event;
}

const SENSITIVE_SPAN_ATTRIBUTE =
  /^(?:http\.(?:request|response)\.(?:header|body)|url\.query$|http\.query$|gen_ai\.(?:prompt|completion|input|output|request\.messages|response\.text)|db\.query\.parameter)/;
const URL_SPAN_ATTRIBUTES = ["url.full", "http.url", "http.target", "url"];

/** `beforeSendSpan` hook: defense in depth on top of the locked-down `dataCollection`. */
export function scrubSentrySpan<T extends ScrubbableSpan>(span: T): T {
  const attributes = span.attributes;
  if (!attributes) return span;

  for (const key of Object.keys(attributes)) {
    if (SENSITIVE_SPAN_ATTRIBUTE.test(key)) delete attributes[key];
  }

  for (const key of URL_SPAN_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === "string") attributes[key] = stripUrlQuery(value);
  }

  return span;
}

/**
 * Errors with a `digest` were thrown during server rendering and are already
 * reported server-side through `onRequestError`; error boundaries only report
 * client-originated errors to avoid duplicates.
 */
export function shouldCaptureBoundaryError(error: { digest?: string }): boolean {
  return !error.digest;
}

export type SentryDataCollection = {
  userInfo: false;
  cookies: false;
  httpHeaders: false;
  httpBodies: never[];
  urlQueryParams: false;
  graphQL: { document: false; variables: false };
  genAI: { inputs: false; outputs: false };
  mcp: { inputs: false; outputs: false };
  databaseQueryData: false;
  queues: false;
  stackFrameVariables: false;
};

export function createSentryDataCollection(): SentryDataCollection {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  };
}

export type SentryBaseInitOptions = {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  dataCollection: SentryDataCollection;
  beforeSend: typeof scrubSentryEvent;
  beforeBreadcrumb: typeof scrubSentryBreadcrumb;
  beforeSendSpan: typeof scrubSentrySpan;
};

/** Returns the shared `Sentry.init()` options, or null when no DSN is configured. */
export function getSentryInitOptions(
  runtime: SentryRuntime,
  env: SentryEnv,
): SentryBaseInitOptions | null {
  const dsn = getSentryDsn(runtime, env);
  if (!dsn) return null;

  const environment = getSentryEnvironment(runtime, env);

  return {
    dsn,
    environment,
    tracesSampleRate: getSentryTracesSampleRate(runtime, env, environment),
    dataCollection: createSentryDataCollection(),
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    beforeSendSpan: scrubSentrySpan,
  };
}
