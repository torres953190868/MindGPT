// Tests for the agent model adapter (impact analysis D1/D6): the mock
// adapter is deterministic and schema-checked; the real adapter's correction
// loop feeds validation errors back to the model and gives up with
// AGENT_INVALID_MODEL_OUTPUT. Network access is stubbed via a fake fetch; LLM
// routing resolves through the static env config (Supabase envs stubbed off).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentError } from "@/lib/agent-runtime/agent-errors";
import {
  createAgentModelAdapter,
  JSON_ACTION_CONTRACT_PROMPT,
  LlmModelAdapter,
  MOCK_MODEL_USAGE,
  MockModelAdapter,
  type AgentModelActionRequest,
} from "@/lib/agent-runtime/model-adapter";

const actionSchema = z.object({
  kind: z.enum(["final", "tool_call"]),
  text: z.string().min(1),
});
type Action = z.infer<typeof actionSchema>;

function createRequest(
  overrides: Partial<AgentModelActionRequest<Action>> = {},
): AgentModelActionRequest<Action> {
  return {
    task: "curriculum_synthesis",
    systemPrompt: "You write curricula.",
    contextMessages: [{ role: "user", content: "Build a calculus curriculum." }],
    actionSchema,
    maxOutputTokens: 321,
    ...overrides,
  };
}

function completionResponse(content: string, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// Mimics real fetch abort semantics: never resolves, rejects with AbortError
// when the passed signal aborts (immediately if already aborted).
function neverResolvingAbortableFetch() {
  return (_url: unknown, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal | null;
      if (!signal) return;
      const rejectAbort = () =>
        reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
}

function readFetchBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as {
    max_tokens: number;
    response_format: { type: string };
    stream: boolean;
    messages: Array<{ role: string; content: string }>;
  };
}

describe("MockModelAdapter (D6)", () => {
  it("returns scripted actions deterministically with fixed usage", async () => {
    const adapter = new MockModelAdapter([
      { action: { kind: "tool_call", text: "search" } },
      { action: { kind: "final", text: "done" }, usage: { completionTokens: 9 } },
    ]);

    const first = await adapter.completeAction(createRequest());
    expect(first.action).toEqual({ kind: "tool_call", text: "search" });
    expect(first.usage).toEqual(MOCK_MODEL_USAGE);
    expect(first.provider).toBe("mock");
    expect(first.model).toBe("mock-model");

    const second = await adapter.completeAction(createRequest());
    expect(second.action).toEqual({ kind: "final", text: "done" });
    expect(second.usage).toEqual({ ...MOCK_MODEL_USAGE, completionTokens: 9 });
    expect(adapter.calls).toHaveLength(2);
  });

  it("supports matcher-based scripts", async () => {
    const adapter = new MockModelAdapter([
      {
        match: (request) => request.task === "tutor_assessment",
        action: { kind: "final", text: "assessed" },
      },
    ]);

    await expect(adapter.completeAction(createRequest())).rejects.toMatchObject({
      code: "AGENT_MOCK_SCRIPT_EXHAUSTED",
    });

    const result = await adapter.completeAction(
      createRequest({ task: "tutor_assessment" }),
    );
    expect(result.action).toEqual({ kind: "final", text: "assessed" });
  });

  it("throws a clear error when the script is exhausted", async () => {
    const adapter = new MockModelAdapter([]);
    await expect(adapter.completeAction(createRequest())).rejects.toMatchObject({
      code: "AGENT_MOCK_SCRIPT_EXHAUSTED",
    });
    await expect(adapter.completeAction(createRequest())).rejects.toBeInstanceOf(AgentError);
  });

  it("rejects scripted actions that fail the action schema", async () => {
    const adapter = new MockModelAdapter([{ action: { kind: "final" } }]);
    await expect(adapter.completeAction(createRequest())).rejects.toMatchObject({
      code: "AGENT_INVALID_MODEL_OUTPUT",
    });
  });

  it("routes stage-keyed entries by request.stage, independent of prompt content", async () => {
    const adapter = new MockModelAdapter([
      { stage: "intake", action: { kind: "final", text: "intake-action" } },
      { stage: "building_graph", action: { kind: "final", text: "skeleton-action" } },
    ]);

    // The prompts carry no markers at all: routing keys on the explicit
    // stage, so prompt copy changes cannot break a stage-keyed script.
    const intake = await adapter.completeAction(createRequest({ stage: "intake" }));
    expect(intake.action).toEqual({ kind: "final", text: "intake-action" });
    const skeleton = await adapter.completeAction(createRequest({ stage: "building_graph" }));
    expect(skeleton.action).toEqual({ kind: "final", text: "skeleton-action" });
  });

  it("never matches stage-keyed entries without a matching request stage", async () => {
    const adapter = new MockModelAdapter([
      { stage: "intake", action: { kind: "final", text: "intake-action" } },
    ]);

    await expect(adapter.completeAction(createRequest())).rejects.toMatchObject({
      code: "AGENT_MOCK_SCRIPT_EXHAUSTED",
    });
    await expect(
      adapter.completeAction(createRequest({ stage: "planning" })),
    ).rejects.toMatchObject({ code: "AGENT_MOCK_SCRIPT_EXHAUSTED" });
  });
});

describe("LlmModelAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // Route through the static env config: no Supabase, one deterministic
    // DeepSeek candidate (fallback is skipped without a configured key).
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("AI_MOCK_MODE", "false");
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    vi.stubEnv("GEMINI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the validated action with usage, provider and model", async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(JSON.stringify({ kind: "final", text: "ok" })),
    );

    const result = await new LlmModelAdapter().completeAction(createRequest());

    expect(result.action).toEqual({ kind: "final", text: "ok" });
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("test-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = readFetchBody(fetchMock.mock.calls[0]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(321);
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("You write curricula.");
    expect(body.messages[0].content).toContain(JSON_ACTION_CONTRACT_PROMPT);
    expect(body.messages[0].content).toContain('"properties":{"kind"');
  });

  it("retries invalid output with the error fed back, then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(completionResponse("this is not json"))
      .mockResolvedValueOnce(
        completionResponse(JSON.stringify({ kind: "final", text: "corrected" })),
      );

    const result = await new LlmModelAdapter().completeAction(createRequest());

    expect(result.action).toEqual({ kind: "final", text: "corrected" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryBody = readFetchBody(fetchMock.mock.calls[1]);
    const roles = retryBody.messages.map((message) => message.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(retryBody.messages[2].content).toBe("this is not json");
    expect(retryBody.messages[3].content).toContain("rejected");
  });

  it("throws AGENT_INVALID_MODEL_OUTPUT after the correction budget is spent", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(completionResponse(JSON.stringify({ kind: "nope" }))),
    );

    const error = await new LlmModelAdapter()
      .completeAction(createRequest())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe("AGENT_INVALID_MODEL_OUTPUT");
    expect((error as AgentError).retryable).toBe(false);
    // Initial attempt + two correction attempts.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("tolerates a single fenced JSON block", async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse("```json\n{\"kind\":\"final\",\"text\":\"fenced\"}\n```"),
    );

    const result = await new LlmModelAdapter().completeAction(createRequest());
    expect(result.action).toEqual({ kind: "final", text: "fenced" });
  });

  it("composes a caller signal with the internal timeout signal", async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse(JSON.stringify({ kind: "final", text: "ok" })),
    );

    const caller = new AbortController();
    const result = await new LlmModelAdapter().completeAction(
      createRequest({ signal: caller.signal }),
    );

    expect(result.action).toEqual({ kind: "final", text: "ok" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // Fetch always receives the internal controller's signal (never the raw
    // caller signal), so the provider timeout stays armed.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(caller.signal);
  });

  it("treats a caller-initiated abort as cancellation, not a timeout", async () => {
    fetchMock.mockImplementation(neverResolvingAbortableFetch());

    const caller = new AbortController();
    const promise = new LlmModelAdapter().completeAction(
      createRequest({ signal: caller.signal }),
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: "AGENT_RUN_CANCELLED",
      retryable: false,
    });
    caller.abort();
    await rejection;

    // Cancellation is not retried, unlike a provider timeout.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("short-circuits an already-aborted caller signal without retrying", async () => {
    fetchMock.mockImplementation(neverResolvingAbortableFetch());

    const caller = new AbortController();
    caller.abort();
    await expect(
      new LlmModelAdapter().completeAction(createRequest({ signal: caller.signal })),
    ).rejects.toMatchObject({
      code: "AGENT_RUN_CANCELLED",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the provider timeout armed when a caller signal is present", async () => {
    fetchMock.mockImplementation(neverResolvingAbortableFetch());
    const caller = new AbortController();
    vi.useFakeTimers();
    try {
      const promise = new LlmModelAdapter().completeAction(
        createRequest({ signal: caller.signal }),
      );
      const rejection = expect(promise).rejects.toMatchObject({
        code: "DEEPSEEK_TIMEOUT",
        retryable: true,
      });
      // Two attempts per candidate: 30s timeout + 300ms retry delay + 30s.
      await vi.advanceTimersByTimeAsync(70_000);
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createAgentModelAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the mock adapter when AI_MOCK_MODE is enabled", () => {
    vi.stubEnv("AI_MOCK_MODE", "true");
    expect(createAgentModelAdapter()).toBeInstanceOf(MockModelAdapter);
  });

  it("returns the real adapter otherwise", () => {
    vi.stubEnv("AI_MOCK_MODE", "false");
    vi.stubEnv("DEEPSEEK_MOCK_MODE", "false");
    vi.stubEnv("MOCK_DEEPSEEK", "false");
    expect(createAgentModelAdapter()).toBeInstanceOf(LlmModelAdapter);
  });
});
