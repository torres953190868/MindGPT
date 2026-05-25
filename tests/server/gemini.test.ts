import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestDeepSeekReply } from "@/lib/server/deepseek";
import {
  streamDeepSeekReply,
  type DeepSeekStreamingEvent,
} from "@/lib/server/deepseek-streaming";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gemini");
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
    instruction: "Explain Gemini streaming",
  })) {
    events.push(event);
  }

  return events;
}

describe("Gemini provider", () => {
  it("routes requests through Gemini's OpenAI-compatible chat completions endpoint", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Gemini model",
                  summary: "Gemini summary",
                  content: "Gemini response content.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await requestDeepSeekReply({ instruction: "Use Gemini" });

    expect(reply.title).toBe("Gemini model");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gemini-key",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "gemini-3.5-flash",
      response_format: { type: "json_object" },
      stream: false,
    });
  });

  it("streams through the Gemini provider configuration", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash");
    const rawReply = JSON.stringify({
      title: "Gemini streaming",
      summary: "Gemini streaming summary",
      content: "Gemini streaming content.",
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

    expect(complete?.reply.content).toBe("Gemini streaming content.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gemini-key",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      model: "gemini-3.5-flash",
      stream: true,
    });
  });
});
