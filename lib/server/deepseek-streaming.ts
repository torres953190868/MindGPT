import {
  createDeepSeekPayload,
  createProviderHttpError,
  deepSeekStreamChunkSchema,
  DeepSeekError,
  getActiveChatApiKey,
  getActiveChatUrl,
  getChatRequestTimeoutMs,
  getMockReply,
  isAbortError,
  isDeepSeekMockMode,
  MAX_DEEPSEEK_ATTEMPTS,
  parseDeepSeekResponse,
  parseStreamingReply,
  RETRY_DELAY_MS,
  resolveChatModelSelection,
  type BranchMindReplyRequest,
} from "@/lib/server/deepseek-core";
import type { ChatCompletionsProvider } from "@/lib/server/ai-provider";
import type { MockReply } from "@/lib/types";

export type DeepSeekStreamingEvent =
  | { type: "delta"; contentDelta: string }
  | { type: "complete"; reply: MockReply };

function getMockStreamingDelayMs() {
  const value = Number(process.env.DEEPSEEK_MOCK_STREAM_DELAY_MS ?? 20);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function splitIntoChunks(value: string, chunkCount = 5) {
  if (!value) return [];
  const size = Math.max(1, Math.ceil(value.length / chunkCount));
  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }

  return chunks;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function* streamMockReply(
  body: BranchMindReplyRequest,
): AsyncGenerator<DeepSeekStreamingEvent> {
  const reply = getMockReply(body);
  const delayMs = getMockStreamingDelayMs();

  for (const contentDelta of splitIntoChunks(reply.content)) {
    if (delayMs > 0) await wait(delayMs);
    yield { type: "delta", contentDelta };
  }

  yield { type: "complete", reply };
}

function readJsonStringPrefix(input: string, start: number) {
  let value = "";

  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index];

    if (character === "\"") {
      return { value, complete: true, endIndex: index };
    }

    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = input[index + 1];
    if (!escaped) return { value, complete: false, endIndex: input.length };

    if (escaped === "u") {
      const hex = input.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        return { value, complete: false, endIndex: input.length };
      }
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }

    const escapes: Record<string, string> = {
      "\"": "\"",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    value += escapes[escaped] ?? escaped;
    index += 1;
  }

  return { value, complete: false, endIndex: input.length };
}

export function getJsonStringValuePrefix(rawJson: string, key: string) {
  for (let index = 0; index < rawJson.length; index += 1) {
    if (rawJson[index] !== "\"") continue;

    const token = readJsonStringPrefix(rawJson, index);
    if (!token.complete) return null;

    let cursor = token.endIndex + 1;
    while (/\s/.test(rawJson[cursor] ?? "")) cursor += 1;
    if (token.value !== key || rawJson[cursor] !== ":") {
      index = token.endIndex;
      continue;
    }

    cursor += 1;
    while (/\s/.test(rawJson[cursor] ?? "")) cursor += 1;
    if (rawJson[cursor] !== "\"") return null;

    return readJsonStringPrefix(rawJson, cursor);
  }

  return null;
}

async function fetchDeepSeekStream(
  body: BranchMindReplyRequest,
  provider: ChatCompletionsProvider,
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
  return fetch(getActiveChatUrl(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(createDeepSeekPayload(body, provider, model, true)),
    signal,
  });
}

function getSseData(block: string) {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

async function* readSseData(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = getSseData(block);
      if (data) yield data;
      boundary = buffer.indexOf("\n\n");
    }

    if (done) break;
  }

  const trailingData = getSseData(buffer);
  if (trailingData) yield trailingData;
}

async function readErrorResponse(response: Response) {
  const data = (await response.json().catch(() => null)) as unknown;
  return data === null ? { error: { message: "DeepSeek API call failed." } } : parseDeepSeekResponse(data);
}

async function* readDeepSeekContentDeltas(stream: ReadableStream<Uint8Array>) {
  for await (const data of readSseData(stream)) {
    if (data === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new DeepSeekError("DeepSeek returned invalid streaming JSON.", 502, {
        code: "DEEPSEEK_INVALID_STREAMING_CHUNK",
        retryable: true,
      });
    }

    const parsed = deepSeekStreamChunkSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DeepSeekError("DeepSeek streaming chunk failed validation.", 502, {
        code: "DEEPSEEK_INVALID_STREAMING_CHUNK",
        retryable: true,
      });
    }

    if (parsed.data.error) {
      throw new DeepSeekError(
        parsed.data.error.message ?? "DeepSeek streaming request failed.",
        502,
        { code: "DEEPSEEK_STREAMING_ERROR", retryable: true },
      );
    }

    const contentDelta = parsed.data.choices?.[0]?.delta?.content;
    if (contentDelta) yield contentDelta;
  }
}

function normalizeStreamingError(
  error: unknown,
  provider: ChatCompletionsProvider,
) {
  if (isAbortError(error)) {
    return new DeepSeekError(`${provider.displayName} request timed out.`, 504, {
      code: `${provider.errorCodePrefix}_TIMEOUT`,
      expose: true,
      retryable: true,
    });
  }

  if (error instanceof DeepSeekError) return error;

  return new DeepSeekError(`${provider.displayName} API request failed.`, 502, {
    code: `${provider.errorCodePrefix}_NETWORK_ERROR`,
    retryable: true,
  });
}

export async function* streamDeepSeekReply(
  body: BranchMindReplyRequest,
): AsyncGenerator<DeepSeekStreamingEvent> {
  if (isDeepSeekMockMode()) {
    yield* streamMockReply(body);
    return;
  }

  const { provider, model } = resolveChatModelSelection(body.modelSelection);
  const apiKey = getActiveChatApiKey(provider);
  let lastError: DeepSeekError | null = null;

  for (let attempt = 1; attempt <= MAX_DEEPSEEK_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      getChatRequestTimeoutMs(provider),
    );
    let emittedDelta = false;
    let rawReply = "";
    let visibleContent = "";

    try {
      const response = await fetchDeepSeekStream(
        body,
        provider,
        apiKey,
        model,
        controller.signal,
      );
      if (!response.ok) {
        throw createProviderHttpError(
          provider,
          response,
          await readErrorResponse(response),
        );
      }
      if (!response.body) {
        throw new DeepSeekError("DeepSeek returned an empty stream.", 502, {
          code: "DEEPSEEK_EMPTY_STREAM",
          retryable: true,
        });
      }

      for await (const rawDelta of readDeepSeekContentDeltas(response.body)) {
        rawReply += rawDelta;
        const contentPrefix = getJsonStringValuePrefix(rawReply, "content");
        if (!contentPrefix || contentPrefix.value.length <= visibleContent.length) {
          continue;
        }

        const contentDelta = contentPrefix.value.slice(visibleContent.length);
        visibleContent = contentPrefix.value;
        emittedDelta = true;
        yield { type: "delta", contentDelta };
      }

      const reply = parseStreamingReply(
        rawReply,
        body.instruction,
        visibleContent,
      );
      if (reply.content.length > visibleContent.length) {
        emittedDelta = true;
        yield {
          type: "delta",
          contentDelta: reply.content.slice(visibleContent.length),
        };
      }
      yield { type: "complete", reply };
      return;
    } catch (error) {
      const nextError = normalizeStreamingError(error, provider);
      lastError = nextError;

      if (
        emittedDelta ||
        !nextError.retryable ||
        attempt >= MAX_DEEPSEEK_ATTEMPTS
      ) {
        throw nextError;
      }

      await wait(RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new DeepSeekError("DeepSeek API call failed.");
}
