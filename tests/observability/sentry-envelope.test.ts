import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTransport,
  defaultStackParser,
  getCurrentScope,
  NodeClient,
  Scope,
  setCurrentClient,
} from "@sentry/nextjs";
import { getSentryInitOptions } from "@/lib/observability/sentry";
import { logApiError } from "@/lib/server/http";

// End-to-end check of the privacy scrubbers: the real `@sentry/nextjs` Node
// client (Vitest resolves the real package, not the webpack noop alias) runs
// the `getSentryInitOptions()` hooks and serializes envelopes into memory.

const DSN = "https://public@o0.ingest.sentry.io/0";
const MARKER = "PRIVATE_MARKER_7f3a";

const clients: NodeClient[] = [];

function createMemoryClient() {
  const options = getSentryInitOptions("server", { SENTRY_DSN: DSN, NODE_ENV: "production" });
  if (!options) throw new Error("expected Sentry options");

  const envelopes: string[] = [];
  const decoder = new TextDecoder();
  const client = new NodeClient({
    ...options,
    integrations: [],
    stackParser: defaultStackParser,
    transport: (transportOptions) =>
      createTransport(transportOptions, async (request) => {
        envelopes.push(typeof request.body === "string" ? request.body : decoder.decode(request.body));
        return { statusCode: 200 };
      }),
  });
  clients.push(client);

  return { client, envelopes };
}

/** Envelope lines are: envelope header, item header, event payload. */
function parseEventPayload(envelope: string) {
  return JSON.parse(envelope.split("\n")[2]) as {
    exception?: { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: unknown[] } }> };
    tags?: Record<string, string>;
  };
}

function tagScope() {
  const scope = new Scope();
  scope.setTags({ request_id: "req_123", status_code: "500", error_code: "UPSTREAM_ERROR", action: "stream-node" });
  return scope;
}

afterEach(async () => {
  getCurrentScope().setClient(undefined);
  await Promise.all(clients.splice(0).map((client) => client.close(1000)));
});

describe("Sentry envelope privacy", () => {
  it("does not send sensitive text from exception messages, extra, contexts, or messages", async () => {
    const { client, envelopes } = createMemoryClient();

    client.captureException(
      new SyntaxError(`Unexpected token 'M', "${MARKER} my diary" is not valid JSON`),
      undefined,
      tagScope(),
    );
    client.captureException(
      new Error(`DeepSeek request failed (400): {"error":{"message":"${MARKER}"}}`),
      undefined,
      tagScope(),
    );
    // Non-Error captures are serialized into `extra.__serialized__` by the SDK.
    client.captureException({ prompt: `${MARKER} pdf text` }, undefined, tagScope());

    const contextScope = tagScope();
    contextScope.setContext("conversation", { content: MARKER });
    contextScope.setExtra("instruction", MARKER);
    client.captureMessage(`Model output was invalid:\n${MARKER}`, "error", undefined, contextScope);

    await client.flush(1000);

    expect(envelopes).toHaveLength(4);
    for (const envelope of envelopes) {
      expect(envelope).not.toContain(MARKER);
      expect(parseEventPayload(envelope).tags).toMatchObject({
        request_id: "req_123",
        status_code: "500",
        error_code: "UPSTREAM_ERROR",
        action: "stream-node",
      });
    }

    const [parseError, providerError] = envelopes.map((envelope) => parseEventPayload(envelope).exception?.values?.[0]);
    expect(parseError).toMatchObject({
      type: "SyntaxError",
      value: `Unexpected token 'M', "[redacted]" is not valid JSON`,
    });
    expect(parseError?.stacktrace?.frames?.length).toBeGreaterThan(0);
    expect(providerError).toMatchObject({ type: "Error", value: "DeepSeek request failed (400): [redacted]" });
  });

  it("keeps logApiError events useful: type, stack, and identifier tags", async () => {
    const { client, envelopes } = createMemoryClient();
    setCurrentClient(client);
    client.init();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const error = Object.assign(new TypeError(`Upstream echoed: "${MARKER}"`), { code: "AI_PROVIDER_FAILED" });
    logApiError(error, 502, "req_789", { action: "stream-node", instruction: MARKER });

    await client.flush(1000);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).not.toContain(MARKER);
    const event = parseEventPayload(envelopes[0]);
    expect(event.exception?.values?.[0]).toMatchObject({ type: "TypeError", value: 'Upstream echoed: "[redacted]"' });
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.length).toBeGreaterThan(0);
    expect(event.tags).toMatchObject({
      request_id: "req_789",
      status_code: "502",
      error_code: "AI_PROVIDER_FAILED",
      action: "stream-node",
    });
  });
});
