// API idempotency (spec §11.5, impact analysis D3): mutating POST routes that
// accept an `Idempotency-Key` header deduplicate on (user_id, endpoint, key)
// for 24 hours and replay the FIRST deterministic response.
//
// Two layers:
// - Same-process concurrency: an in-flight map keyed by
//   (userId, endpoint, key) makes concurrent double-clicks share ONE handler
//   execution; late subscribers get the same result marked replayed.
// - Persistence: the agent-run repository's idempotency store (file backend
//   for dev/tests, Supabase idempotency_keys table in production) covers
//   sequential duplicates and cross-process retries.
//
// Only 2xx/4xx responses are stored — a 5xx stays retryable for the client.
// Requests without an Idempotency-Key header execute directly and store
// nothing.

import { getAgentRunRepository } from "@/lib/agent-runtime/agent-run-repository";

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type IdempotencyScope = {
  request: Request;
  endpoint: string;
  userId: string;
};

export type IdempotentResult<T> = {
  status: number;
  body: T;
  replayed: boolean;
};

const inFlight = new Map<string, Promise<IdempotentResult<unknown>>>();

function isFresh(createdAtIso: string) {
  const createdAt = Date.parse(createdAtIso);
  return !Number.isNaN(createdAt) && createdAt >= Date.now() - IDEMPOTENCY_WINDOW_MS;
}

export async function withIdempotency<T>(
  scope: IdempotencyScope,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const key = scope.request.headers.get("Idempotency-Key")?.trim();
  if (!key) {
    const result = await handler();
    return { ...result, replayed: false };
  }

  const scopeKey = `${scope.userId} ${scope.endpoint} ${key}`;
  const pending = inFlight.get(scopeKey);
  if (pending) {
    const result = (await pending) as IdempotentResult<T>;
    return { ...result, replayed: true };
  }

  const execute = (async (): Promise<IdempotentResult<unknown>> => {
    const repository = getAgentRunRepository();
    const existing = await repository.findIdempotencyRecord(scope.userId, scope.endpoint, key);
    if (existing && existing.statusCode !== null && isFresh(existing.createdAt)) {
      return { status: existing.statusCode, body: existing.response, replayed: true };
    }

    const result = await handler();
    if (result.status < 500) {
      await repository.saveIdempotencyRecord({
        userId: scope.userId,
        endpoint: scope.endpoint,
        key,
        statusCode: result.status,
        response: result.body,
      });
    }
    return { ...result, replayed: false };
  })();

  inFlight.set(scopeKey, execute);
  try {
    return (await execute) as IdempotentResult<T>;
  } finally {
    inFlight.delete(scopeKey);
  }
}
