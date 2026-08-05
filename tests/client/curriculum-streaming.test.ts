import { describe, expect, it } from "vitest";
import { readCurriculumStreamEvents } from "@/lib/client/curriculum-streaming";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

function encodeSse(event: string, data: unknown) {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createMockResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

describe("readCurriculumStreamEvents", () => {
  it("parses a full run of curriculum stream events", async () => {
    const events: CurriculumStreamEvent[] = [
      { type: "run_started", runId: "run_1", seq: 1 },
      { type: "stage_started", runId: "run_1", seq: 2, stage: "intake" },
      { type: "stage_started", runId: "run_1", seq: 3, stage: "searching" },
      { type: "search_started", runId: "run_1", seq: 4, query: "linear regression" },
      { type: "search_completed", runId: "run_1", seq: 5, query: "linear regression", resultCount: 8 },
      {
        type: "source_selected",
        runId: "run_1",
        seq: 6,
        source: {
          url: "https://example.com",
          title: "Example Source",
          sourceType: "official_documentation",
          qualityScore: 0.9,
        },
      },
      { type: "run_completed", runId: "run_1", seq: 7, curriculumVersionId: "version_1" },
    ];

    const chunks = events.map((event) => encodeSse(event.type, event));
    const response = createMockResponse(chunks);
    const received: CurriculumStreamEvent[] = [];

    const result = await readCurriculumStreamEvents(response, (event) => received.push(event));

    expect(received).toHaveLength(events.length);
    expect(received).toEqual(events);
    expect(result.sawTerminal).toBe(true);
  });

  it("handles chunked events split across multiple reads", async () => {
    const event1 = { type: "run_started", runId: "run_2", seq: 1 };
    const event2 = { type: "stage_started", runId: "run_2", seq: 2, stage: "planning" };

    const encoder = new TextEncoder();
    const data1 = `event: ${event1.type}\ndata: ${JSON.stringify(event1)}\n\nevent: ${event2.type}\n`;
    const data2 = `data: ${JSON.stringify(event2)}\n\n`;

    const response = createMockResponse([encoder.encode(data1), encoder.encode(data2)]);
    const received: CurriculumStreamEvent[] = [];

    await readCurriculumStreamEvents(response, (event) => received.push(event));

    expect(received).toEqual([event1, event2]);
  });

  it("reports sawTerminal false when stream ends without terminal event", async () => {
    const events: CurriculumStreamEvent[] = [
      { type: "run_started", runId: "run_3", seq: 1 },
      { type: "stage_started", runId: "run_3", seq: 2, stage: "searching" },
    ];

    const response = createMockResponse(events.map((event) => encodeSse(event.type, event)));
    const result = await readCurriculumStreamEvents(response, () => {});

    expect(result.sawTerminal).toBe(false);
  });

  it("throws ApiRequestError for non-ok responses", async () => {
    const response = new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 });

    await expect(readCurriculumStreamEvents(response, () => {})).rejects.toThrow(/Too many requests/);
  });

  it("ignores malformed SSE blocks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode("event: run_started\ndata: not-json\n\n"),
      encoder.encode('event: run_started\ndata: {"runId":"run_4","seq":1}\n\n'),
    ];
    const response = createMockResponse(chunks);
    const received: CurriculumStreamEvent[] = [];

    await readCurriculumStreamEvents(response, (event) => received.push(event));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: "run_started", runId: "run_4", seq: 1 });
  });
});
