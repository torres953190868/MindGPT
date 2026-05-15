import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import {
  streamDeepSeekReply,
  type DeepSeekStreamingEvent,
} from "@/lib/server/deepseek-streaming";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "opencode-go");
  vi.stubEnv("AI_MOCK_MODE", "false");
  vi.stubEnv("DEEPSEEK_MOCK_MODE", "false");
  vi.stubEnv("MOCK_DEEPSEEK", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

describe("OpenCode Go provider", () => {
  it("routes requests through the Go chat completions endpoint", async () => {
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
    vi.stubEnv("OPENCODE_GO_MODEL", "kimi-k2.6");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Go model",
                  summary: "OpenCode Go summary",
                  content: "OpenCode Go response content.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({ instruction: "Use Go" });

    expect(reply.title).toBe("Go model");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer go-key",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "kimi-k2.6",
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(requestBody).not.toHaveProperty("thinking");
  });

  it("rejects models outside the allowlist before calling upstream", async () => {
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
    vi.stubEnv("OPENCODE_GO_MODEL", "minimax-m2.7");
    vi.stubEnv("OPENCODE_GO_ALLOWED_MODELS", "kimi-k2.6");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekReply({ instruction: "Reject messages endpoint models" }),
    ).rejects.toMatchObject({
      code: "OPENCODE_GO_MODEL_NOT_ALLOWED",
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams through the Go provider configuration", async () => {
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-key");
    vi.stubEnv("OPENCODE_GO_MODEL", "qwen3.6-plus");
    const rawReply = JSON.stringify({
      title: "Go streaming",
      summary: "Go streaming summary",
      content: "OpenCode Go streaming content.",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([createSseChunk(rawReply), "data: [DONE]\n\n"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = await collectStreamingEvents();
    const complete = events.find(
      (event): event is Extract<DeepSeekStreamingEvent, { type: "complete" }> =>
        event.type === "complete",
    );

    expect(complete?.reply.content).toBe("OpenCode Go streaming content.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer go-key",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "qwen3.6-plus",
      stream: true,
    });
  });
});
