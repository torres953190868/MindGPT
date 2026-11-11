import {
  createDeepSeekPayload,
  createProviderHttpError,
  deepSeekStreamChunkSchema,
  DeepSeekError,
  getJsonStringValuePrefix,
  getMockReply,
  isAbortError,
  isDeepSeekMockMode,
  MAX_DEEPSEEK_ATTEMPTS,
  parseDeepSeekResponse,
  parseStreamingReply,
  RETRY_DELAY_MS,
  type BranchMindReplyRequest,
  withReplyCitations,
} from "@/lib/server/deepseek-core";
import {
  getLlmProviderApiKey,
  getLlmRequestTimeoutMs,
  resolveLlmCandidates,
  type LlmRuntimeProvider,
} from "@/lib/server/llm-router";
import type { MockReply } from "@/lib/types";

export { getJsonStringValuePrefix };

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

async function fetchDeepSeekStream(
  body: BranchMindReplyRequest,
  provider: LlmRuntimeProvider,
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
  return fetch(provider.baseUrl, {
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

type DeepSeekStreamPiece = {
  contentDelta?: string;
  finishReason?: string;
};

async function* readDeepSeekContentDeltas(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<DeepSeekStreamPiece> {
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

    const choice = parsed.data.choices?.[0];
    const contentDelta = choice?.delta?.content ?? undefined;
    const finishReason =
      typeof choice?.finish_reason === "string" && choice.finish_reason.trim()
        ? choice.finish_reason.trim()
        : undefined;

    if (contentDelta || finishReason) {
      yield { contentDelta, finishReason };
    }
  }
}

function normalizeStreamingError(
  error: unknown,
  provider: LlmRuntimeProvider,
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

  let lastError: DeepSeekError | null = null;
  const candidates = await resolveLlmCandidates(
    body.llmTask ?? "node_generation",
    body.modelSelection,
    { requireJson: true, requireStreaming: true, accountPlan: body.userPlan },
  );

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const provider = candidate.provider;
    const apiKey = getLlmProviderApiKey(provider);
    if (!apiKey) {
      throw new DeepSeekError(`${provider.apiKeyEnv} is not configured.`, 500, {
        code: `${provider.errorCodePrefix}_NOT_CONFIGURED`,
      });
    }
    const model = candidate.model.model;

    for (let attempt = 1; attempt <= MAX_DEEPSEEK_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        getLlmRequestTimeoutMs(provider),
      );
      let emittedDelta = false;
      let rawReply = "";
      let visibleContent = "";
      let finishReason: string | null = null;

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
          throw new DeepSeekError(`${provider.displayName} returned an empty stream.`, 502, {
            code: `${provider.errorCodePrefix}_EMPTY_STREAM`,
            retryable: true,
          });
        }

        for await (const piece of readDeepSeekContentDeltas(response.body)) {
          if (piece.finishReason) {
            finishReason = piece.finishReason;
          }
          if (!piece.contentDelta) {
            continue;
          }

          rawReply += piece.contentDelta;
          const contentPrefix = getJsonStringValuePrefix(rawReply, "content");
          if (!contentPrefix || contentPrefix.value.length <= visibleContent.length) {
            continue;
          }

          const contentDelta = contentPrefix.value.slice(visibleContent.length);
          visibleContent = contentPrefix.value;
          emittedDelta = true;
          yield { type: "delta", contentDelta };
        }

        const reply = withReplyCitations(
          parseStreamingReply(
            rawReply,
            body.instruction,
            visibleContent,
            { truncatedByLength: finishReason === "length" },
          ),
          body.documentContexts,
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

        if (emittedDelta || !nextError.retryable) {
          throw nextError;
        }

        if (attempt < MAX_DEEPSEEK_ATTEMPTS) {
          await wait(RETRY_DELAY_MS);
          continue;
        }

        if (candidateIndex >= candidates.length - 1) {
          throw nextError;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw lastError ?? new DeepSeekError("DeepSeek API call failed.");
}
