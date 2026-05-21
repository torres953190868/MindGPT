import {
  createDeepSeekPayload,
  delay,
  DeepSeekError,
  getActiveChatApiKey,
  getActiveChatUrl,
  getChatRequestTimeoutMs,
  getDeepSeekContent,
  getMockReply,
  isAbortError,
  isDeepSeekMockMode,
  MAX_DEEPSEEK_ATTEMPTS,
  parseDeepSeekResponse,
  parseReply,
  RETRY_DELAY_MS,
  resolveChatModelSelection,
  type BranchMindReplyRequest,
  createProviderHttpError,
} from "@/lib/server/deepseek-core";
import type { ChatCompletionsProvider } from "@/lib/server/ai-provider";

export { DeepSeekError, type BranchMindReplyRequest };

async function fetchDeepSeek(
  body: BranchMindReplyRequest,
  provider: ChatCompletionsProvider,
  apiKey: string,
  model: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getChatRequestTimeoutMs(provider),
  );

  try {
    return await fetch(getActiveChatUrl(provider), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(createDeepSeekPayload(body, provider, model, false)),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new DeepSeekError(`${provider.displayName} request timed out.`, 504, {
        code: `${provider.errorCodePrefix}_TIMEOUT`,
        expose: true,
        retryable: true,
      });
    }

    throw new DeepSeekError(`${provider.displayName} API request failed.`, 502, {
      code: `${provider.errorCodePrefix}_NETWORK_ERROR`,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readDeepSeekResponse(response: Response) {
  const data = (await response.json().catch(() => null)) as unknown;

  if (data === null) {
    throw new DeepSeekError("DeepSeek returned invalid JSON.", 502, {
      code: "DEEPSEEK_INVALID_JSON",
      retryable: true,
    });
  }

  return parseDeepSeekResponse(data);
}

export async function requestDeepSeekReply(
  body: BranchMindReplyRequest,
): Promise<ReturnType<typeof getMockReply>> {
  if (isDeepSeekMockMode()) {
    return getMockReply(body);
  }

  const { provider, model } = resolveChatModelSelection(body.modelSelection);
  const apiKey = getActiveChatApiKey(provider);
  let lastError: DeepSeekError | null = null;

  for (let attempt = 1; attempt <= MAX_DEEPSEEK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchDeepSeek(body, provider, apiKey, model);
      const data = await readDeepSeekResponse(response);

      if (!response.ok) {
        throw createProviderHttpError(provider, response, data);
      }

      const content = getDeepSeekContent(data);
      if (!content) {
        throw new DeepSeekError("DeepSeek returned an empty response.", 502, {
          code: "DEEPSEEK_EMPTY_RESPONSE",
          retryable: true,
        });
      }

      return parseReply(content, body.instruction);
    } catch (error) {
      if (!(error instanceof DeepSeekError)) throw error;
      lastError = error;

      if (!error.retryable || attempt >= MAX_DEEPSEEK_ATTEMPTS) {
        throw error;
      }

      await delay(RETRY_DELAY_MS);
    }
  }

  throw lastError ?? new DeepSeekError("DeepSeek API call failed.");
}
