import { ApiRequestError, formatApiErrorMessage, getApiErrorMeta } from "@/lib/client/api";
import type { CurriculumStreamEvent } from "@/lib/agent-runtime/stream-events";

export type CurriculumStreamingEvent = CurriculumStreamEvent;

export type CurriculumStreamError = {
  type: "stream_error";
  code: string | null;
  message: string;
  requestId: string | null;
};

type SseBlock = {
  event: string;
  data: string;
};

function parseSseBlock(buffer: string): SseBlock | null {
  const lines = buffer.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const event = eventLine?.slice(6).trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  return data ? { event, data } : null;
}

function hasTerminalEvent(events: CurriculumStreamEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "run_completed" ||
      event.type === "run_failed" ||
      event.type === "run_cancelled",
  );
}

function parseEventFromBlock(block: SseBlock): CurriculumStreamEvent | null {
  try {
    const payload = JSON.parse(block.data) as unknown;
    if (!payload || typeof payload !== "object") return null;

    const typed = payload as { type?: string; runId?: string; seq?: number };
    const type = typeof typed.type === "string" ? typed.type : block.event;
    if (!type || typeof typed.runId !== "string" || typeof typed.seq !== "number") {
      return null;
    }

    return { ...typed, type } as CurriculumStreamEvent;
  } catch {
    return null;
  }
}

function parseErrorBlock(block: SseBlock): CurriculumStreamError | null {
  try {
    const payload = JSON.parse(block.data) as Record<string, unknown>;
    if (block.event === "error" || payload.error) {
      return {
        type: "stream_error",
        code: typeof payload.code === "string" ? payload.code : null,
        message:
          typeof payload.message === "string"
            ? payload.message
            : formatApiErrorMessage({ error: payload }, Number(payload.status) || 500),
        requestId: typeof payload.requestId === "string" ? payload.requestId : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function readCurriculumStreamEvents(
  response: Response,
  onEvent: (event: CurriculumStreamEvent) => void,
  options: { onError?: (error: CurriculumStreamError) => void; signal?: AbortSignal } = {},
): Promise<{ events: CurriculumStreamEvent[]; sawTerminal: boolean }> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as unknown;
    throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
      ...getApiErrorMeta(data),
      status: response.status,
    });
  }

  if (!response.body) {
    throw new Error("Server did not return a streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: CurriculumStreamEvent[] = [];

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new Error(options.signal.reason ?? "Stream aborted.");
      }

      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (!parsed) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        const error = parseErrorBlock(parsed);
        if (error) {
          options.onError?.(error);
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        const event = parseEventFromBlock(parsed);
        if (event) {
          events.push(event);
          onEvent(event);
        }
        boundary = buffer.indexOf("\n\n");
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  const trailing = parseSseBlock(buffer);
  if (trailing) {
    const error = parseErrorBlock(trailing);
    if (error) {
      options.onError?.(error);
    } else {
      const event = parseEventFromBlock(trailing);
      if (event) {
        events.push(event);
        onEvent(event);
      }
    }
  }

  return { events, sawTerminal: hasTerminalEvent(events) };
}
