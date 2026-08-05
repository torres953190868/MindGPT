// Tests for the API idempotency wrapper (spec §11.5): no-key pass-through,
// first-response replay within 24h, 5xx never stored, and same-process
// concurrent double-clicks executing the handler exactly once. Runs against
// the file-backed agent-run repository with an isolated tmpdir.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withIdempotency, type IdempotencyScope } from "@/lib/server/idempotency";

const OWNER = "user_idempotency";

let dataDir: string;
let dataFile: string;

function createScope(key?: string, overrides: Partial<IdempotencyScope> = {}): IdempotencyScope {
  return {
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: key ? { "Idempotency-Key": key } : {},
    }),
    endpoint: "POST /api/test",
    userId: OWNER,
    ...overrides,
  };
}

function okHandler(payload: Record<string, unknown> = { ok: true }) {
  return vi.fn(async () => ({ status: 200, body: payload }));
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "branchmind-idempotency-"));
  dataFile = path.join(dataDir, "branchmind-agent-runs.json");
  vi.stubEnv("BRANCHMIND_CURRICULUM_BACKEND", "file");
  vi.stubEnv("BRANCHMIND_AGENT_RUNS_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

describe("withIdempotency", () => {
  it("passes requests without a key straight through and stores nothing", async () => {
    const handler = okHandler();

    const first = await withIdempotency(createScope(), handler);
    const second = await withIdempotency(createScope(), handler);

    expect(first).toEqual({ status: 200, body: { ok: true }, replayed: false });
    expect(second.replayed).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("executes the first keyed request and replays it for duplicates", async () => {
    const handler = okHandler({ runId: "run_123" });
    const scope = createScope("key-abc");

    const first = await withIdempotency(scope, handler);
    expect(first).toEqual({ status: 200, body: { runId: "run_123" }, replayed: false });

    const duplicate = await withIdempotency(scope, okHandler({ runId: "run_other" }));
    expect(duplicate).toEqual({ status: 200, body: { runId: "run_123" }, replayed: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("scopes dedup to (user, endpoint, key)", async () => {
    const key = "key-shared";
    await withIdempotency(createScope(key), okHandler({ n: 1 }));

    const otherUser = await withIdempotency(
      createScope(key, { userId: "user_other" }),
      okHandler({ n: 2 }),
    );
    expect(otherUser).toMatchObject({ body: { n: 2 }, replayed: false });

    const otherEndpoint = await withIdempotency(
      createScope(key, { endpoint: "POST /api/other" }),
      okHandler({ n: 3 }),
    );
    expect(otherEndpoint).toMatchObject({ body: { n: 3 }, replayed: false });
  });

  it("never stores 5xx responses so the client can retry", async () => {
    const scope = createScope("key-retry");
    const failing = vi.fn(async () => ({ status: 500, body: { error: "boom" } }));

    const first = await withIdempotency(scope, failing);
    expect(first).toEqual({ status: 500, body: { error: "boom" }, replayed: false });

    const retry = await withIdempotency(scope, okHandler());
    expect(retry).toEqual({ status: 200, body: { ok: true }, replayed: false });
    expect(failing).toHaveBeenCalledTimes(1);

    const afterSuccess = await withIdempotency(scope, okHandler({ ok: false }));
    expect(afterSuccess.replayed).toBe(true);
    expect(afterSuccess.body).toEqual({ ok: true });
  });

  it("expires stored responses after 24 hours", async () => {
    const scope = createScope("key-stale");
    await withIdempotency(scope, okHandler({ generation: 1 }));

    // Age the stored record beyond the 24h window.
    const data = JSON.parse(await readFile(dataFile, "utf8")) as {
      idempotencyKeys: Array<{ created_at: string }>;
    };
    expect(data.idempotencyKeys).toHaveLength(1);
    data.idempotencyKeys[0].created_at = new Date(
      Date.now() - 25 * 60 * 60 * 1_000,
    ).toISOString();
    await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    const refreshed = await withIdempotency(scope, okHandler({ generation: 2 }));
    expect(refreshed).toEqual({ status: 200, body: { generation: 2 }, replayed: false });
  });

  it("executes the handler exactly once for concurrent same-key requests", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await gate;
      return { status: 200, body: { ok: true } };
    });
    const scope = createScope("key-concurrent");

    const firstPromise = withIdempotency(scope, handler);
    const secondPromise = withIdempotency(scope, handler);
    // Let the first handler start and the second caller attach to the
    // in-flight entry.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release!();

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ status: 200, body: { ok: true }, replayed: false });
    expect(second).toEqual({ status: 200, body: { ok: true }, replayed: true });
  });
});
