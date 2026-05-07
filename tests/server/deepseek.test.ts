import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import {
  getJsonStringValuePrefix,
  streamDeepSeekReply,
  type DeepSeekStreamingEvent,
} from "@/lib/server/deepseek-streaming";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "deepseek");
  vi.stubEnv("AI_MOCK_MODE", "false");
  vi.stubEnv("DEEPSEEK_MOCK_MODE", "false");
  vi.stubEnv("MOCK_DEEPSEEK", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requestDeepSeekReply", () => {
  it("requires an API key before making the outbound request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain trees" }),
    ).rejects.toMatchObject({
      name: "DeepSeekError",
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects models outside the allowlist before calling DeepSeek", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "unapproved-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "deepseek-chat");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain allowlists" }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_MODEL_NOT_ALLOWED",
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses JSON replies and trims user-facing fields", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "  A compact branch title  ",
                  summary: "  This summary is normalized for display.  ",
                  content: "  The full response is preserved after trimming.  ",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({
      mode: "branch",
      instruction: "Map supervised learning",
      contextTitles: ["Root", "Algorithms"],
      messages: [{ role: "user", content: "previous question" }],
      sourceText: "selected source",
    });

    expect(reply).toEqual({
      title: "A compact branch title",
      summary: "This summary is normalized for display.",
      content: "The full response is preserved after trimming.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(requestBody.messages[1].content).toContain("Selected source text: selected source");
  });

  it("retries retryable upstream API failures once", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
            status: 429,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Explain rate limits" }),
    ).rejects.toMatchObject({
      status: 429,
      message: "quota exceeded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps 500, invalid JSON, and empty responses to stable DeepSeekError codes", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");

    const cases = [
      {
        response: new Response(JSON.stringify({ error: { message: "server down" } }), {
          status: 500,
        }),
        expected: { code: "DEEPSEEK_RETRYABLE_ERROR", status: 500 },
      },
      {
        response: new Response("not-json", { status: 200 }),
        expected: { code: "DEEPSEEK_INVALID_JSON", status: 502 },
      },
      {
        response: new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 200,
        }),
        expected: { code: "DEEPSEEK_EMPTY_RESPONSE", status: 502 },
      },
    ];

    for (const testCase of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => Promise.resolve(testCase.response.clone())),
      );

      await expect(
        requestDeepSeekReply({ instruction: "Exercise error handling" }),
      ).rejects.toMatchObject(testCase.expected);
    }
  });

  it("maps aborted requests to timeout errors", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(
      requestDeepSeekReply({ instruction: "Exercise timeout handling" }),
    ).rejects.toMatchObject({
      code: "DEEPSEEK_TIMEOUT",
      status: 504,
    });
  });
});

function createSseChunk(content: string) {
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: { content },
        finish_reason: null,
        index: 0,
      },
    ],
  })}\n\n`;
}

function createSseResponse(parts: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" }, status: 200 },
  );
}

async function collectStreamingEvents() {
  const events: DeepSeekStreamingEvent[] = [];

  for await (const event of streamDeepSeekReply({
    instruction: "Explain streaming",
  })) {
    events.push(event);
  }

  return events;
}

describe("streamDeepSeekReply", () => {
  it("streams only visible content deltas from split SSE JSON chunks", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    const rawReply = JSON.stringify({
      title: "Streaming title",
      summary: "Streaming summary",
      content: "Line one\nLine \"two\" and unicode: \u4f60\u597d",
    });
    const body = [
      createSseChunk(rawReply.slice(0, 18)),
      createSseChunk(rawReply.slice(18, 52)),
      createSseChunk(rawReply.slice(52)),
      "data: [DONE]\n\n",
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([body.slice(0, 41), body.slice(41, 103), body.slice(103)]),
      ),
    );

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(streamedContent).toBe("Line one\nLine \"two\" and unicode: \u4f60\u597d");
    expect(complete?.reply).toMatchObject({
      title: "Streaming title",
      summary: "Streaming summary",
      content: streamedContent,
    });
  });

  it("does not emit an incomplete escaped JSON sequence", () => {
    expect(getJsonStringValuePrefix('{"content":"hello\\nwor', "content")).toMatchObject({
      complete: false,
      value: "hello\nwor",
    });
    expect(getJsonStringValuePrefix('{"content":"hello\\u4f', "content")).toMatchObject({
      complete: false,
      value: "hello",
    });
  });

  it("rejects invalid final streaming JSON", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_MODEL", "test-model");
    vi.stubEnv("DEEPSEEK_ALLOWED_MODELS", "test-model");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createSseResponse([createSseChunk('{"title":'), "data: [DONE]\n\n"]),
      ),
    );

    await expect(collectStreamingEvents()).rejects.toMatchObject({
      code: "DEEPSEEK_INVALID_STREAMING_JSON",
      status: 502,
    });
  });

  it("streams deterministic mock replies without calling DeepSeek", async () => {
    vi.stubEnv("AI_MOCK_MODE", "true");
    vi.stubEnv("DEEPSEEK_MOCK_STREAM_DELAY_MS", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const events = await collectStreamingEvents();
    const streamedContent = events
      .filter((event): event is Extract<DeepSeekStreamingEvent, { type: "delta" }> =>
        event.type === "delta",
      )
      .map((event) => event.contentDelta)
      .join("");
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(streamedContent).toContain("Mock mode is enabled");
    expect(complete?.reply.content).toBe(streamedContent);
  });
});
